import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { FindComponentPda, FindEntityPda, ApplySystem, SerializeArgs, BN, anchor } from '@magicblock-labs/bolt-sdk';

export const MAGICBLOCK_RPC = 'https://rpc.magicblock.app/devnet/';

export const COMPONENT_IDS = {
	TRADING_ACCOUNT: new PublicKey('3PDo9AKeLhU6hcUC7gft3PKQuotH4624mcevqdSiyTPS'),
	COMPETITION: new PublicKey('FPKpeKHnfYuYo8JDiDW7mNzZB8qgf1mLYwpQAcbGyVhJ'),
	POSITION: new PublicKey('9ACLRxNoDHXpHugLUmDtBGTQ6Q5vwnD4wUVSaWaNaVbv'),
	LEADERBOARD: new PublicKey('BCrmcoi7dEgg7UY3SpZfM4dihAWaYuNk3wprXsy1Xp5X'),
};

export const SYSTEM_IDS = {
	JOIN_COMPETITION: new PublicKey('5aJzg88rRLAFGN1imRwK84WMD4JyZBvz7n47nSQz9oGm'),
	OPEN_POSITION: new PublicKey('GdWvbNgbNxWHbSDTBweSi9zPgtRhggGxaJsCxL5vwDp9'),
	CLOSE_POSITION: new PublicKey('CXnKyp5DGMWRHsj9JsbECqBbDP1GeUF3c8AYSPZMmNb2'),
	SETTLE_COMPETITION: new PublicKey('32S5nHLK93PNVJQZgd4PQY4v9tkiLU2j9bEbHhJN4CuL'),
};

export const TRADING_PAIRS = {
	SOL: 0,
	BTC: 1,
	ETH: 2,
	AVAX: 3,
	LINK: 4,
};

export enum PositionDirection {
	Long = 'LONG',
	Short = 'SHORT',
}

export const WORLD_ID = new BN(2409);
export const WORLD_INSTANCE_ID = new PublicKey('CVndFdiiuFhkcLEQy71JomGwgZT8Lqeq9oFuU14E9Ngk');

export class MagicBlockClient {
	connection: Connection;
	wallet: Keypair | null = null;
	sessionWallet: Keypair | null = null;
	entityPda: PublicKey | null = null;
	competitionEntity: PublicKey | null = null;

	constructor() {
		this.connection = new Connection(MAGICBLOCK_RPC, 'confirmed');
	}

	async initializeSessionWallet(): Promise<Keypair> {
		console.log('[MAGICBLOCK] Initializing session wallet...');

		const stored = localStorage.getItem('magicblock_session_wallet');
		if (stored) {
			try {
				const secretKey = Uint8Array.from(JSON.parse(stored));
				this.sessionWallet = Keypair.fromSecretKey(secretKey);
				console.log('[MAGICBLOCK] Loaded session wallet:', this.sessionWallet.publicKey.toBase58());
				await this.initializeEntity();
				this.setupProvider();
				return this.sessionWallet;
			} catch (e) {
				console.log('[MAGICBLOCK] Failed to load stored wallet, creating new one');
			}
		}

		this.sessionWallet = Keypair.generate();
		localStorage.setItem(
			'magicblock_session_wallet',
			JSON.stringify(Array.from(this.sessionWallet.secretKey))
		);
		console.log('[MAGICBLOCK] Created new session wallet:', this.sessionWallet.publicKey.toBase58());

		await this.initializeEntity();
		this.setupProvider();
		return this.sessionWallet;
	}

	async initializeEntity(): Promise<void> {
		if (!this.sessionWallet) return;

		try {
			this.entityPda = FindEntityPda({
				worldId: WORLD_ID,
				seed: Buffer.from(this.sessionWallet.publicKey.toBytes()),
			});
			console.log('[MAGICBLOCK] Entity PDA:', this.entityPda.toBase58());

			this.competitionEntity = new PublicKey('5ebXENtrEamPapRhzMGjvrcavWwrEwWiY4Yftjx3wUsk');
			console.log('[MAGICBLOCK] Competition entity:', this.competitionEntity.toBase58());
		} catch (e) {
			console.error('[MAGICBLOCK] Failed to initialize entity:', e);
		}
	}

	setAdminWallet(secretKeyBase58: string): void {
		try {
			const secretKey = Keypair.fromSecretKey(
				Uint8Array.from(Buffer.from(secretKeyBase58, 'base64'))
			);
			this.wallet = secretKey;
			console.log('[MAGICBLOCK] Admin wallet set:', this.wallet.publicKey.toBase58());
		} catch (e) {
			console.error('[MAGICBLOCK] Failed to set admin wallet:', e);
		}
	}

	getProvider(): anchor.AnchorProvider {
		if (!this.sessionWallet) {
			throw new Error('Session wallet not initialized');
		}

		const wallet = {
			publicKey: this.sessionWallet.publicKey,
			signTransaction: async (tx: Transaction) => {
				tx.partialSign(this.sessionWallet!);
				return tx;
			},
			signAllTransactions: async (txs: Transaction[]) => {
				return txs.map((tx) => {
					tx.partialSign(this.sessionWallet!);
					return tx;
				});
			},
		};

		return new anchor.AnchorProvider(this.connection, wallet as any, {
			commitment: 'confirmed',
		});
	}

	setupProvider(): void {
		const provider = this.getProvider();
		anchor.setProvider(provider);
		console.log('[MAGICBLOCK] Global provider set for Bolt SDK');
	}

	async getTradingAccountPDA(owner: PublicKey): Promise<[PublicKey, number]> {
		return PublicKey.findProgramAddressSync(
			[Buffer.from('trading-account'), owner.toBuffer()],
			COMPONENT_IDS.TRADING_ACCOUNT
		);
	}

	async getPositionPDA(
		tradingAccount: PublicKey,
		positionId: number
	): Promise<[PublicKey, number]> {
		return PublicKey.findProgramAddressSync(
			[Buffer.from('position'), tradingAccount.toBuffer(), Buffer.from([positionId])],
			COMPONENT_IDS.POSITION
		);
	}

	async openPosition(
		pairSymbol: string,
		direction: PositionDirection,
		currentPrice: number,
		size: number,
		takeProfit?: number,
		stopLoss?: number
	): Promise<string> {
		if (!this.sessionWallet || !this.entityPda || !this.competitionEntity) {
			throw new Error('Session wallet or entity not initialized');
		}

		console.log('[MAGICBLOCK] Opening position:', {
			pair: pairSymbol,
			direction,
			price: currentPrice,
			size,
		});

		const pairIndex = TRADING_PAIRS[pairSymbol as keyof typeof TRADING_PAIRS];
		if (pairIndex === undefined) {
			throw new Error(`Unknown trading pair: ${pairSymbol}`);
		}

		const priceScaled = Math.floor(currentPrice * 1e8);
		const sizeScaled = Math.floor(size * 1e8);
		const takeProfitScaled = takeProfit ? Math.floor(takeProfit * 1e8) : null;
		const stopLossScaled = stopLoss ? Math.floor(stopLoss * 1e8) : null;

		try {
			const competitionComponentPda = FindComponentPda({
				componentId: COMPONENT_IDS.COMPETITION,
				entity: this.competitionEntity,
			});

			const tradingAccountComponentPda = FindComponentPda({
				componentId: COMPONENT_IDS.TRADING_ACCOUNT,
				entity: this.entityPda,
			});

			const positionTimestamp = Date.now();
			const positionEntityPda = FindEntityPda({
				worldId: WORLD_ID,
				seed: Buffer.from(`position_${positionTimestamp}`),
			});

			const positionComponentPda = FindComponentPda({
				componentId: COMPONENT_IDS.POSITION,
				entity: positionEntityPda,
			});

			const argsData = {
			pair_index: pairIndex,
			direction: direction === PositionDirection.Long ? 0 : 1,
			current_price: priceScaled,
			size: sizeScaled,
			take_profit: takeProfitScaled || 0,
			stop_loss: stopLossScaled || 0,
		};

		const args = SerializeArgs(argsData);

			const { transaction } = await ApplySystem({
				authority: this.sessionWallet.publicKey,
				systemId: SYSTEM_IDS.OPEN_POSITION,
				entities: [
					{
						entity: this.competitionEntity,
						components: [{ componentId: COMPONENT_IDS.COMPETITION }],
					},
					{
						entity: this.entityPda,
						components: [{ componentId: COMPONENT_IDS.TRADING_ACCOUNT }],
					},
					{
						entity: positionEntityPda,
						components: [{ componentId: COMPONENT_IDS.POSITION }],
					},
				],
				world: WORLD_INSTANCE_ID,
				args: args,
			});

			const signature = await sendAndConfirmTransaction(
				this.connection,
				transaction,
				[this.sessionWallet],
				{ commitment: 'confirmed' }
			);

			console.log('[MAGICBLOCK] Position opened:', signature);
			return signature;
		} catch (error) {
			console.error('[MAGICBLOCK] Failed to open position:', error);
			throw error;
		}
	}

	async closePosition(positionId: string): Promise<string> {
		if (!this.sessionWallet || !this.entityPda || !this.competitionEntity) {
			throw new Error('Session wallet or entity not initialized');
		}

		console.log('[MAGICBLOCK] Closing position:', positionId);

		try {
			const positionEntityPda = new PublicKey(positionId);

			const { transaction } = await ApplySystem({
				authority: this.sessionWallet.publicKey,
				systemId: SYSTEM_IDS.CLOSE_POSITION,
				entities: [
					{
						entity: this.competitionEntity,
						components: [{ componentId: COMPONENT_IDS.COMPETITION }],
					},
					{
						entity: this.entityPda,
						components: [{ componentId: COMPONENT_IDS.TRADING_ACCOUNT }],
					},
					{
						entity: positionEntityPda,
						components: [{ componentId: COMPONENT_IDS.POSITION }],
					},
				],
				world: WORLD_INSTANCE_ID,
			});

			const signature = await sendAndConfirmTransaction(
				this.connection,
				transaction,
				[this.sessionWallet],
				{ commitment: 'confirmed' }
			);

			console.log('[MAGICBLOCK] Position closed:', signature);
			return signature;
		} catch (error) {
			console.error('[MAGICBLOCK] Failed to close position:', error);
			throw error;
		}
	}

	async fetchPositions(): Promise<any[]> {
		if (!this.sessionWallet) {
			return [];
		}

		try {
			console.log('[MAGICBLOCK] Fetching positions...');
			return [];
		} catch (error) {
			console.error('[MAGICBLOCK] Failed to fetch positions:', error);
			return [];
		}
	}

	async requestAirdrop(amount: number = 1): Promise<string> {
		if (!this.sessionWallet) {
			throw new Error('Session wallet not initialized');
		}

		console.log('[MAGICBLOCK] Requesting airdrop...');
		const signature = await this.connection.requestAirdrop(
			this.sessionWallet.publicKey,
			amount * LAMPORTS_PER_SOL
		);

		// Don't wait for confirmation, just return signature
		// Confirmation can take a long time on devnet
		console.log('[MAGICBLOCK] Airdrop requested:', signature);

		// Poll for balance update in background
		setTimeout(async () => {
			for (let i = 0; i < 10; i++) {
				await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
				const balance = await this.connection.getBalance(this.sessionWallet!.publicKey);
				if (balance > 0) {
					console.log('[MAGICBLOCK] Airdrop confirmed! Balance:', balance / LAMPORTS_PER_SOL);
					break;
				}
			}
		}, 0);

		return signature;
	}

	async getBalance(): Promise<number> {
		if (!this.sessionWallet) {
			return 0;
		}

		const balance = await this.connection.getBalance(this.sessionWallet.publicKey);
		return balance / LAMPORTS_PER_SOL;
	}

	async mintTrophyNFT(
		rank: number,
		winnerAddress: PublicKey,
		competitionId: string,
		finalPnl: number,
		totalTrades: number
	): Promise<string> {
		if (!this.wallet) {
			throw new Error('Admin wallet not initialized');
		}

		console.log('[MAGICBLOCK] Minting trophy NFT for rank', rank);

		const mintKeypair = Keypair.generate();

		const [metadataPDA] = PublicKey.findProgramAddressSync(
			[
				Buffer.from('metadata'),
				new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s').toBuffer(),
				mintKeypair.publicKey.toBuffer(),
			],
			new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')
		);

		const SETTLE_COMPETITION_PROGRAM_ID = SYSTEM_IDS.SETTLE_COMPETITION;

		const associatedTokenAddress = await this.getAssociatedTokenAddress(
			mintKeypair.publicKey,
			winnerAddress
		);

		try {
			const instruction = await this.createMintTrophyInstruction(
				this.wallet.publicKey,
				winnerAddress,
				mintKeypair.publicKey,
				associatedTokenAddress,
				metadataPDA,
				rank,
				competitionId,
				finalPnl,
				totalTrades
			);

			const transaction = new Transaction().add(instruction);
			transaction.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
			transaction.feePayer = this.wallet.publicKey;

			transaction.sign(this.wallet, mintKeypair);

			const signature = await sendAndConfirmTransaction(
				this.connection,
				transaction,
				[this.wallet, mintKeypair],
				{ commitment: 'confirmed' }
			);

			console.log('[MAGICBLOCK] Trophy NFT minted:', signature);
			console.log('[MAGICBLOCK] Mint address:', mintKeypair.publicKey.toBase58());
			return signature;
		} catch (error) {
			console.error('[MAGICBLOCK] Failed to mint trophy NFT:', error);
			throw error;
		}
	}

	async getAssociatedTokenAddress(mint: PublicKey, owner: PublicKey): Promise<PublicKey> {
		const [address] = PublicKey.findProgramAddressSync(
			[owner.toBuffer(), new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA').toBuffer(), mint.toBuffer()],
			new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
		);
		return address;
	}

	async createMintTrophyInstruction(
		authority: PublicKey,
		winner: PublicKey,
		mint: PublicKey,
		tokenAccount: PublicKey,
		metadata: PublicKey,
		rank: number,
		competitionId: string,
		finalPnl: number,
		totalTrades: number
	): Promise<any> {
		const args = {
			rank,
			competitionId,
			finalPnl: Math.floor(finalPnl * 1e8),
			totalTrades,
		};

		const accounts = {
			authority,
			winner,
			mint,
			tokenAccount,
			metadata,
			tokenProgram: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
			associatedTokenProgram: new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
			systemProgram: new PublicKey('11111111111111111111111111111111'),
			rent: new PublicKey('SysvarRent111111111111111111111111111111111'),
			tokenMetadataProgram: new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'),
		};

		return {
			keys: [
				{ pubkey: accounts.authority, isSigner: true, isWritable: true },
				{ pubkey: accounts.winner, isSigner: false, isWritable: true },
				{ pubkey: accounts.mint, isSigner: true, isWritable: true },
				{ pubkey: accounts.tokenAccount, isSigner: false, isWritable: true },
				{ pubkey: accounts.metadata, isSigner: false, isWritable: true },
				{ pubkey: accounts.tokenProgram, isSigner: false, isWritable: false },
				{ pubkey: accounts.associatedTokenProgram, isSigner: false, isWritable: false },
				{ pubkey: accounts.systemProgram, isSigner: false, isWritable: false },
				{ pubkey: accounts.rent, isSigner: false, isWritable: false },
				{ pubkey: accounts.tokenMetadataProgram, isSigner: false, isWritable: false },
			],
			programId: SYSTEM_IDS.SETTLE_COMPETITION,
			data: Buffer.from(JSON.stringify(args)),
		};
	}
}

export const magicBlockClient = new MagicBlockClient();
