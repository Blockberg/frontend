import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL, Transaction, sendAndConfirmTransaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { FindEntityPda, ApplySystem, SerializeArgs, BN, anchor } from '@magicblock-labs/bolt-sdk';
import type { Adapter, SignerWalletAdapter } from '@solana/wallet-adapter-base';

export const MAGICBLOCK_RPC = 'https://rpc.magicblock.app/devnet/';
export const SOLANA_RPC = 'https://api.devnet.solana.com';

// Paper Trading Program ID from the contract
export const PAPER_TRADING_PROGRAM_ID = new PublicKey('2zaegVL5odaCikNPEzCnaicgvu1n9ueHZoQrvEPWX161');

export const COMPONENT_IDS = {
	TRADING_ACCOUNT: new PublicKey('3PDo9AKeLhU6hcUC7gft3PKQuotH4624mcevqdSiyTPS'),
	COMPETITION: new PublicKey('FPKpeKHnfYuYo8JDiDW7mNzZB8qgf1mLYwpQAcbGyVhJ'),
	POSITION: new PublicKey('9ACLRxNoDHXpHugLUmDtBGTQ6Q5vwnD4wUVSaWaNaVbv'),
	LEADERBOARD: new PublicKey('BCrmcoi7dEgg7UY3SpZfM4dihAWaYuNk3wprXsy1Xp5X'),
};

export const SYSTEM_IDS = {
	JOIN_COMPETITION: new PublicKey('5aJzg88rRLAFGN1imRwK84WMD4JyZBvz7n47nSQz9oGm'),
	OPEN_POSITION: new PublicKey('GdWvbNgbNxWHbSDTBweSi9zPgtRhggGxaJsCxL5vwDp9'),
	CLOSE_POSITION: new PublicKey('CXnKyp5DGMWRHsj9JsbECqBbDP1GeUF3c8AYSPZMmNd2'),
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
	connectedWallet: Adapter | null = null;
	entityPda: PublicKey | null = null;
	competitionEntity: PublicKey | null = null;

	constructor() {
		this.connection = new Connection(MAGICBLOCK_RPC, 'confirmed');
	}

	// Set connected wallet adapter
	setConnectedWallet(wallet: Adapter | null) {
		this.connectedWallet = wallet;
		console.log('[MAGICBLOCK] Connected wallet set:', wallet?.name || 'None');
	}

	// Get current wallet (prioritize connected wallet over session wallet)
	getCurrentWallet(): { publicKey: PublicKey; signTransaction?: (tx: Transaction) => Promise<Transaction>; signAllTransactions?: (txs: Transaction[]) => Promise<Transaction[]> } | null {
		if (this.connectedWallet?.connected && this.connectedWallet.publicKey) {
			const signerWallet = this.connectedWallet as SignerWalletAdapter;
			return {
				publicKey: this.connectedWallet.publicKey,
				signTransaction: signerWallet.signTransaction?.bind(signerWallet),
				signAllTransactions: signerWallet.signAllTransactions?.bind(signerWallet)
			};
		}
		
		if (this.sessionWallet) {
			return {
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
				}
			};
		}

		return null;
	}

	// Check if we have a connected wallet
	isWalletConnected(): boolean {
		return !!(this.connectedWallet?.connected || this.sessionWallet);
	}

	// Get user account PDA for a specific pair
	getUserAccountPDA(userPubkey: PublicKey, pairIndex: number): [PublicKey, number] {
		return PublicKey.findProgramAddressSync(
			[
				Buffer.from('user'),
				userPubkey.toBuffer(),
				Buffer.from([pairIndex])
			],
			PAPER_TRADING_PROGRAM_ID
		);
	}

	// Get config PDA
	getConfigPDA(): [PublicKey, number] {
		return PublicKey.findProgramAddressSync(
			[Buffer.from('config')],
			PAPER_TRADING_PROGRAM_ID
		);
	}

	// Check if user has initialized their trading account for a specific pair
	async checkAccountInitialized(userPubkey: PublicKey, pairIndex: number): Promise<boolean> {
		try {
			const [userAccountPDA] = this.getUserAccountPDA(userPubkey, pairIndex);
			const accountInfo = await this.connection.getAccountInfo(userAccountPDA);
			return accountInfo !== null;
		} catch (error) {
			console.error('[MAGICBLOCK] Failed to check account initialization:', error);
			return false;
		}
	}

	// Initialize trading account for a user - MagicBlock ephemeral rollup approach
	async initializeAccount(pairIndex: number, entryFee: number = 0.1, initialTokenIn: number = 10000): Promise<string> {
		const currentWallet = this.getCurrentWallet();
		if (!currentWallet) {
			throw new Error('Wallet not connected');
		}

		try {
			console.log('[MAGICBLOCK] Initializing trading account for pair', pairIndex);

			// Create connection to main Solana (not ephemeral)
			const mainConnection = new Connection('https://api.devnet.solana.com', 'confirmed');
			
			const [userAccountPDA] = this.getUserAccountPDA(currentWallet.publicKey, pairIndex);
			const [configPDA] = this.getConfigPDA();
			
			// Check if account already exists
			const existingAccount = await mainConnection.getAccountInfo(userAccountPDA);
			if (existingAccount) {
				console.log('[MAGICBLOCK] Account already initialized for pair', pairIndex);
				return 'account_already_exists';
			}
			
			// Get treasury from config on main chain
			const configAccountInfo = await mainConnection.getAccountInfo(configPDA);
			if (!configAccountInfo) {
				throw new Error('Config account not found on main chain');
			}
			const treasuryPubkey = new PublicKey(configAccountInfo.data.subarray(40, 72));

			const entryFeeScaled = Math.floor(entryFee * LAMPORTS_PER_SOL);
			const initialTokenInScaled = Math.floor(initialTokenIn * 1e6);

			// Setup for potential Anchor usage (keeping for future use)

			// Calculate the correct Anchor discriminator
			const methodName = "global:initialize_account";
			const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(methodName));
			const discriminator = new Uint8Array(hash).slice(0, 8);
			
			console.log('[MAGICBLOCK] Calculated discriminator:', Array.from(discriminator));
			
			// Create instruction data buffer
			const instructionData = Buffer.alloc(25);
			Buffer.from(discriminator).copy(instructionData, 0);
			instructionData.writeUInt8(pairIndex, 8);
			instructionData.writeBigUInt64LE(BigInt(entryFeeScaled), 9);
			instructionData.writeBigUInt64LE(BigInt(initialTokenInScaled), 17);

			const instruction = new TransactionInstruction({
				keys: [
					{ pubkey: userAccountPDA, isSigner: false, isWritable: true },
					{ pubkey: configPDA, isSigner: false, isWritable: false },
					{ pubkey: currentWallet.publicKey, isSigner: true, isWritable: true },
					{ pubkey: treasuryPubkey, isSigner: false, isWritable: true },
					{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
				],
				programId: PAPER_TRADING_PROGRAM_ID,
				data: instructionData
			});

			const transaction = new Transaction().add(instruction);
			
			// Get fresh blockhash to avoid duplicate transaction issues
			const latestBlockhash = await mainConnection.getLatestBlockhash('finalized');
			transaction.recentBlockhash = latestBlockhash.blockhash;
			transaction.feePayer = currentWallet.publicKey;

			console.log('[MAGICBLOCK] Transaction details:', {
				userAccount: userAccountPDA.toBase58(),
				treasury: treasuryPubkey.toBase58(),
				pairIndex,
				entryFee: entryFeeScaled,
				blockhash: latestBlockhash.blockhash
			});

			// Sign and send transaction on main chain
			let signature: string;
			if (currentWallet.signTransaction) {
				const signedTx = await currentWallet.signTransaction(transaction);
				signature = await mainConnection.sendRawTransaction(signedTx.serialize(), {
					skipPreflight: false,
					preflightCommitment: 'finalized'
				});
			} else {
				throw new Error('Wallet does not support transaction signing');
			}

			console.log('[MAGICBLOCK] Account initialized on main chain:', signature);
			
			// Wait for confirmation
			await mainConnection.confirmTransaction(signature, 'confirmed');
			
			return signature;
		} catch (error) {
			console.error('[MAGICBLOCK] Failed to initialize account:', error);
			throw error;
		}
	}

	// Get account status for all pairs
	async getAccountStatus(): Promise<{ [pairIndex: number]: boolean }> {
		const currentWallet = this.getCurrentWallet();
		if (!currentWallet) {
			return {};
		}

		const status: { [pairIndex: number]: boolean } = {};
		
		// Check initialization status for all trading pairs
		for (const [, pairIndex] of Object.entries(TRADING_PAIRS)) {
			status[pairIndex] = await this.checkAccountInitialized(currentWallet.publicKey, pairIndex);
		}

		return status;
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
		const currentWallet = this.getCurrentWallet();
		if (!currentWallet) {
			throw new Error('No wallet available');
		}

		const wallet = {
			publicKey: currentWallet.publicKey,
			signTransaction: currentWallet.signTransaction || (async (tx: Transaction) => {
				throw new Error('Wallet does not support transaction signing');
			}),
			signAllTransactions: currentWallet.signAllTransactions || (async (txs: Transaction[]) => {
				throw new Error('Wallet does not support multiple transaction signing');
			}),
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
		const currentWallet = this.getCurrentWallet();
		if (!currentWallet) {
			throw new Error('Wallet not connected');
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

		// First try MagicBlock rollup execution
		try {
			return await this.openMagicBlockPosition(
				currentWallet,
				pairIndex,
				direction,
				currentPrice,
				size,
				takeProfit,
				stopLoss
			);
		} catch (error) {
			console.warn('[MAGICBLOCK] MagicBlock rollup failed, falling back to direct contract:', error);
			
			// Fallback to direct contract call
			return await this.openDirectPosition(
				currentWallet,
				pairIndex,
				direction,
				currentPrice,
				size,
				takeProfit,
				stopLoss
			);
		}
	}

	private async openMagicBlockPosition(
		currentWallet: any,
		pairIndex: number,
		direction: PositionDirection,
		currentPrice: number,
		size: number,
		takeProfit?: number,
		stopLoss?: number
	): Promise<string> {
		console.log('[MAGICBLOCK] Opening MagicBlock position via direct paper trading program...');
		
		// Instead of using Bolt systems, let's execute the paper trading program directly
		// through the MagicBlock rollup, using the same logic as the direct contract
		
		const priceScaled = Math.floor(currentPrice * 1e6); // 6 decimals for price
		// Calculate required token_in balance: size * currentPrice (both in their respective scales)
		const requiredTokenIn = Math.floor(size * currentPrice * 1e6); // This should match token_in_balance scale
		const amountTokenOut = Math.floor(size * 1e9); // 9 decimals for token amount
		const takeProfitScaled = takeProfit ? Math.floor(takeProfit * 1e6) : 0;
		const stopLossScaled = stopLoss ? Math.floor(stopLoss * 1e6) : 0;

		// Check if user has sufficient balance before attempting the transaction
		const accountData = await this.getUserAccountData(pairIndex);
		if (!accountData) {
			throw new Error(`Trading account not found for pair ${pairIndex}. Please initialize first.`);
		}

		const requiredBalance = requiredTokenIn / 1e6; // Convert back to readable format for comparison
		console.log('[MAGICBLOCK] Balance check:', {
			available: accountData.tokenInBalance,
			required: requiredBalance,
			size,
			currentPrice
		});

		if (accountData.tokenInBalance < requiredBalance) {
			throw new Error(`Insufficient balance. Required: ${requiredBalance.toFixed(2)} USDT, Available: ${accountData.tokenInBalance.toFixed(2)} USDT`);
		}

		console.log('[MAGICBLOCK] Trading params:', {
			direction,
			pairIndex,
			priceScaled,
			amountTokenOut: amountTokenOut.toString(),
			takeProfitScaled,
			stopLossScaled
		});

		// Get the user account PDA for this pair
		const [userAccountPDA] = this.getUserAccountPDA(currentWallet.publicKey, pairIndex);
		
		// Check if account is initialized on MagicBlock
		const accountInfo = await this.connection.getAccountInfo(userAccountPDA);
		if (!accountInfo) {
			throw new Error(`Trading account not initialized for pair ${pairIndex}. Please initialize first.`);
		}

		// Create the instruction data for the paper trading program
		let methodName: string;
		if (direction === PositionDirection.Long) {
			methodName = "global:open_long_position";
		} else {
			methodName = "global:open_short_position";  
		}

		const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(methodName));
		const discriminator = new Uint8Array(hash).slice(0, 8);

		// Create instruction data buffer (discriminator + 4 u64s)
		const instructionData = Buffer.alloc(8 + 32); // 8 bytes discriminator + 32 bytes for 4 u64s
		Buffer.from(discriminator).copy(instructionData, 0);
		instructionData.writeBigUInt64LE(BigInt(requiredTokenIn), 8); // Use requiredTokenIn for the amount
		instructionData.writeBigUInt64LE(BigInt(priceScaled), 16);
		instructionData.writeBigUInt64LE(BigInt(takeProfitScaled), 24);
		instructionData.writeBigUInt64LE(BigInt(stopLossScaled), 32);

		// Calculate position PDA - read total_positions from account data
		const dataView = new DataView(accountInfo.data.buffer, accountInfo.data.byteOffset, accountInfo.data.byteLength);
		const totalPositions = dataView.getBigUint64(8 + 32 + 1 + 8 + 8, true); // little endian
		
		// Convert totalPositions to little endian bytes (8 bytes for u64)
		const totalPositionsBuffer = Buffer.allocUnsafe(8);
		totalPositionsBuffer.writeBigUInt64LE(totalPositions);

		const [positionPDA] = PublicKey.findProgramAddressSync(
			[
				Buffer.from('position'),
				currentWallet.publicKey.toBuffer(),
				Buffer.from([pairIndex]),
				totalPositionsBuffer
			],
			PAPER_TRADING_PROGRAM_ID
		);

		// Create the transaction instruction to execute on MagicBlock
		const instruction = new TransactionInstruction({
			keys: [
				{ pubkey: userAccountPDA, isSigner: false, isWritable: true },
				{ pubkey: positionPDA, isSigner: false, isWritable: true },
				{ pubkey: currentWallet.publicKey, isSigner: true, isWritable: true },
				{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
			],
			programId: PAPER_TRADING_PROGRAM_ID,
			data: instructionData
		});

		const transaction = new Transaction().add(instruction);
		
		// Get fresh blockhash from MagicBlock connection
		const latestBlockhash = await this.connection.getLatestBlockhash('confirmed');
		transaction.recentBlockhash = latestBlockhash.blockhash;
		transaction.feePayer = currentWallet.publicKey;

		console.log('[MAGICBLOCK] Signing paper trading transaction on MagicBlock rollup...');
		const signedTx = await currentWallet.signTransaction(transaction);
		const signature = await this.connection.sendRawTransaction(signedTx.serialize(), {
			skipPreflight: false,
			preflightCommitment: 'confirmed'
		});

		// Wait for confirmation on MagicBlock
		await this.connection.confirmTransaction({
			signature,
			blockhash: latestBlockhash.blockhash,
			lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
		}, 'confirmed');

		console.log('[MAGICBLOCK] MagicBlock rollup position opened:', signature);
		return signature;
	}

	private async openDirectPosition(
		currentWallet: any,
		pairIndex: number,
		direction: PositionDirection,
		currentPrice: number,
		size: number,
		takeProfit?: number,
		stopLoss?: number
	): Promise<string> {
		// Use the main Solana connection for direct contract calls
		const mainConnection = new Connection(SOLANA_RPC, 'confirmed');
		
		const [userAccountPDA] = this.getUserAccountPDA(currentWallet.publicKey, pairIndex);
		
		// Check if account is initialized
		const accountInfo = await mainConnection.getAccountInfo(userAccountPDA);
		if (!accountInfo) {
			throw new Error(`Trading account not initialized for pair ${pairIndex}. Please initialize first.`);
		}

		const priceScaled = Math.floor(currentPrice * 1e6); // 6 decimals for price
		const requiredTokenIn = Math.floor(size * currentPrice * 1e6); // Required balance for the position
		const amountTokenOut = Math.floor(size * 1e9); // 9 decimals for token amount
		const takeProfitScaled = takeProfit ? Math.floor(takeProfit * 1e6) : 0;
		const stopLossScaled = stopLoss ? Math.floor(stopLoss * 1e6) : 0;

		// Check balance using main connection to get the most up-to-date data
		const tempConnection = this.connection;
		this.connection = mainConnection; // Temporarily switch connection
		const accountData = await this.getUserAccountData(pairIndex);
		this.connection = tempConnection; // Switch back
		
		if (!accountData) {
			throw new Error(`Trading account not found for pair ${pairIndex}. Please initialize first.`);
		}

		const requiredBalance = requiredTokenIn / 1e6; // Convert back to readable format
		console.log('[MAGICBLOCK] Direct contract balance check:', {
			available: accountData.tokenInBalance,
			required: requiredBalance,
			size,
			currentPrice
		});

		if (accountData.tokenInBalance < requiredBalance) {
			throw new Error(`Insufficient balance. Required: ${requiredBalance.toFixed(2)} USDT, Available: ${accountData.tokenInBalance.toFixed(2)} USDT`);
		}

		// Create the instruction data
		let methodName: string;
		if (direction === PositionDirection.Long) {
			methodName = "global:open_long_position";
		} else {
			methodName = "global:open_short_position";  
		}

		const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(methodName));
		const discriminator = new Uint8Array(hash).slice(0, 8);

		// Create instruction data buffer (discriminator + 4 u64s)
		const instructionData = Buffer.alloc(8 + 32); // 8 bytes discriminator + 32 bytes for 4 u64s
		Buffer.from(discriminator).copy(instructionData, 0);
		instructionData.writeBigUInt64LE(BigInt(requiredTokenIn), 8); // Use requiredTokenIn for the amount
		instructionData.writeBigUInt64LE(BigInt(priceScaled), 16);
		instructionData.writeBigUInt64LE(BigInt(takeProfitScaled), 24);
		instructionData.writeBigUInt64LE(BigInt(stopLossScaled), 32);

		// Calculate position PDA - read total_positions from account data
		const dataView = new DataView(accountInfo.data.buffer, accountInfo.data.byteOffset, accountInfo.data.byteLength);
		const totalPositions = dataView.getBigUint64(8 + 32 + 1 + 8 + 8, true); // little endian
		
		// Convert totalPositions to little endian bytes (8 bytes for u64)
		const totalPositionsBuffer = Buffer.allocUnsafe(8);
		totalPositionsBuffer.writeBigUInt64LE(totalPositions);

		const [positionPDA] = PublicKey.findProgramAddressSync(
			[
				Buffer.from('position'),
				currentWallet.publicKey.toBuffer(),
				Buffer.from([pairIndex]),
				totalPositionsBuffer
			],
			PAPER_TRADING_PROGRAM_ID
		);

		const instruction = new TransactionInstruction({
			keys: [
				{ pubkey: userAccountPDA, isSigner: false, isWritable: true },
				{ pubkey: positionPDA, isSigner: false, isWritable: true },
				{ pubkey: currentWallet.publicKey, isSigner: true, isWritable: true },
				{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
			],
			programId: PAPER_TRADING_PROGRAM_ID,
			data: instructionData
		});

		const transaction = new Transaction().add(instruction);
		
		// Get fresh blockhash
		const latestBlockhash = await mainConnection.getLatestBlockhash('confirmed');
		transaction.recentBlockhash = latestBlockhash.blockhash;
		transaction.feePayer = currentWallet.publicKey;

		console.log('[MAGICBLOCK] Signing direct contract transaction...');
		const signedTx = await currentWallet.signTransaction(transaction);
		const signature = await mainConnection.sendRawTransaction(signedTx.serialize(), {
			skipPreflight: false,
			preflightCommitment: 'confirmed'
		});

		// Wait for confirmation
		await mainConnection.confirmTransaction({
			signature,
			blockhash: latestBlockhash.blockhash,
			lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
		}, 'confirmed');

		console.log('[MAGICBLOCK] Direct contract position opened:', signature);
		return signature;
	}

	async closePosition(positionId: string): Promise<string> {
		const currentWallet = this.getCurrentWallet();
		if (!currentWallet || !this.entityPda || !this.competitionEntity) {
			throw new Error('Wallet not connected or entity not initialized');
		}

		console.log('[MAGICBLOCK] Closing position:', positionId);

		try {
			const positionEntityPda = new PublicKey(positionId);

			const { transaction } = await ApplySystem({
				authority: currentWallet.publicKey,
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

			// Get fresh blockhash and set transaction properties
			const latestBlockhash = await this.connection.getLatestBlockhash('confirmed');
			transaction.recentBlockhash = latestBlockhash.blockhash;
			transaction.feePayer = currentWallet.publicKey;

			// Sign and send transaction
			let signature: string;
			if (currentWallet.signTransaction) {
				console.log('[MAGICBLOCK] Signing close position transaction...');
				const signedTx = await currentWallet.signTransaction(transaction);
				signature = await this.connection.sendRawTransaction(signedTx.serialize(), {
					skipPreflight: false,
					preflightCommitment: 'confirmed'
				});
				
				// Wait for confirmation
				await this.connection.confirmTransaction({
					signature,
					blockhash: latestBlockhash.blockhash,
					lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
				}, 'confirmed');
			} else if (this.sessionWallet) {
				// Fallback to session wallet signing
				signature = await sendAndConfirmTransaction(
					this.connection,
					transaction,
					[this.sessionWallet],
					{ commitment: 'confirmed' }
				);
			} else {
				throw new Error('No signing method available');
			}

			console.log('[MAGICBLOCK] Position closed:', signature);
			return signature;
		} catch (error) {
			console.error('[MAGICBLOCK] Failed to close position:', error);
			throw error;
		}
	}

	async fetchPositions(): Promise<any[]> {
		const currentWallet = this.getCurrentWallet();
		if (!currentWallet) {
			return [];
		}

		let positions: any[] = [];

		// Try to fetch MagicBlock positions first
		if (this.entityPda) {
			try {
				console.log('[MAGICBLOCK] Fetching MagicBlock positions...');
				
				const positionAccounts = await this.connection.getProgramAccounts(COMPONENT_IDS.POSITION, {
					filters: [
						{
							memcmp: {
								offset: 8, // Skip discriminator
								bytes: this.entityPda.toBase58() // Filter by entity
							}
						}
					]
				});

				for (const accountInfo of positionAccounts) {
					try {
						const data = accountInfo.account.data;
						positions.push({
							type: 'magicblock',
							pubkey: accountInfo.pubkey.toBase58(),
							data: data.toString('hex').substring(0, 100) + '...'
						});
					} catch (parseError) {
						console.warn('[MAGICBLOCK] Failed to parse MagicBlock position:', parseError);
					}
				}

				console.log('[MAGICBLOCK] Found', positions.length, 'MagicBlock positions');
			} catch (error) {
				console.warn('[MAGICBLOCK] Failed to fetch MagicBlock positions:', error);
			}
		}

		// Also fetch direct contract positions
		try {
			console.log('[MAGICBLOCK] Fetching direct contract positions...');
			const mainConnection = new Connection(SOLANA_RPC, 'confirmed');

			const directPositions = await mainConnection.getProgramAccounts(PAPER_TRADING_PROGRAM_ID, {
				filters: [
					{
						memcmp: {
							offset: 8, // Skip discriminator
							bytes: currentWallet.publicKey.toBase58() // Filter by user
						}
					},
					{
						dataSize: 8 + 32 + 1 + 8 + 8 + 8 + 8 + 1 + 8 + 8 // Size of PositionAccount struct
					}
				]
			});

			for (const accountInfo of directPositions) {
				try {
					// Parse position data from the contract
					const data = accountInfo.account.data;
					const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
					
					// Skip discriminator (8) + owner (32) + pair_index (1)
					const positionId = dataView.getBigUint64(8 + 32 + 1, true);
					const positionType = data[8 + 32 + 1 + 8]; // 0 = Long, 1 = Short
					const amountTokenOut = dataView.getBigUint64(8 + 32 + 1 + 8 + 1, true);
					const entryPrice = dataView.getBigUint64(8 + 32 + 1 + 8 + 1 + 8, true);
					const status = data[8 + 32 + 1 + 8 + 1 + 8 + 8 + 8 + 8]; // 0 = Active, 1 = Closed

					if (status === 0) { // Only show active positions
						positions.push({
							type: 'direct',
							pubkey: accountInfo.pubkey.toBase58(),
							positionId: positionId.toString(),
							direction: positionType === 0 ? 'LONG' : 'SHORT',
							amountTokenOut: Number(amountTokenOut) / 1e9,
							entryPrice: Number(entryPrice) / 1e6,
							status: 'ACTIVE'
						});
					}
				} catch (parseError) {
					console.warn('[MAGICBLOCK] Failed to parse direct position:', parseError);
				}
			}

			console.log('[MAGICBLOCK] Found', directPositions.length, 'direct contract positions');
		} catch (error) {
			console.warn('[MAGICBLOCK] Failed to fetch direct contract positions:', error);
		}

		console.log('[MAGICBLOCK] Total positions found:', positions.length);
		return positions;
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
		const currentWallet = this.getCurrentWallet();
		if (!currentWallet) {
			return 0;
		}

		const balance = await this.connection.getBalance(currentWallet.publicKey);
		return balance / LAMPORTS_PER_SOL;
	}

	// Get mock token balances for a specific trading pair
	async getUserAccountData(pairIndex: number): Promise<{ tokenInBalance: number; tokenOutBalance: number; totalPositions: number } | null> {
		const currentWallet = this.getCurrentWallet();
		if (!currentWallet) {
			return null;
		}

		try {
			const [userAccountPDA] = this.getUserAccountPDA(currentWallet.publicKey, pairIndex);
			const accountInfo = await this.connection.getAccountInfo(userAccountPDA);
			
			if (!accountInfo) {
				return null;
			}

			// Parse the account data according to the UserAccount struct
			const data = accountInfo.data;
			
			// Skip the 8-byte discriminator
			let offset = 8;
			
			// Skip owner (32 bytes)
			offset += 32;
			
			// Skip pair_index (1 byte)  
			offset += 1;
			
			// Read token_in_balance (8 bytes, u64)
			const tokenInBalanceRaw = data.readBigUInt64LE(offset);
			offset += 8;
			
			// Read token_out_balance (8 bytes, u64)
			const tokenOutBalanceRaw = data.readBigUInt64LE(offset);
			offset += 8;
			
			// Read total_positions (8 bytes, u64)
			const totalPositions = Number(data.readBigUInt64LE(offset));

			// Convert to readable format (token_in has 6 decimals, token_out has 9 decimals)
			const tokenInBalance = Number(tokenInBalanceRaw) / 1e6;  // USDT-like token
			const tokenOutBalance = Number(tokenOutBalanceRaw) / 1e9;  // SOL/BTC/ETH-like token

			return {
				tokenInBalance,
				tokenOutBalance,
				totalPositions
			};
		} catch (error) {
			console.error('[MAGICBLOCK] Failed to get user account data:', error);
			return null;
		}
	}

	// Get mock token balances for all initialized trading pairs
	async getAllUserAccountData(): Promise<{ [pairIndex: number]: { tokenInBalance: number; tokenOutBalance: number; totalPositions: number } }> {
		const accountData: { [pairIndex: number]: { tokenInBalance: number; tokenOutBalance: number; totalPositions: number } } = {};
		
		// Check all trading pairs
		for (const [, pairIndex] of Object.entries(TRADING_PAIRS)) {
			const data = await this.getUserAccountData(pairIndex);
			if (data) {
				accountData[pairIndex] = data;
			}
		}

		return accountData;
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
