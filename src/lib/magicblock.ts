import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { FindComponentPda, FindEntityPda, ApplySystem, SerializeArgs, BN } from '@magicblock-labs/bolt-sdk';

export const MAGICBLOCK_RPC = 'https://rpc.magicblock.app/devnet/';

export const COMPONENT_IDS = {
	TRADING_ACCOUNT: new PublicKey('3UhnNbUpRi1QM6szPYJce4tBNLCbjxMESJJ8touBd55h'),
	COMPETITION: new PublicKey('zQKpawEnbpdRj7MPzPuBKjJdgmSCC2A1aNi3NbGv4PN'),
	POSITION: new PublicKey('8NHfJVx1ZD8tnb23v4xvTsUdhMxhHbjYpPz4ZDstobYP'),
	LEADERBOARD: new PublicKey('5ohgmFUcN41uoZuP1QnFP9ErjDDCXA1FaxpFZAzfwU6q'),
};

export const SYSTEM_IDS = {
	JOIN_COMPETITION: new PublicKey('FFRL7nSQxFYMEcUxb912WsvbMSDMPNefdgCe4aZYNxWk'),
	OPEN_POSITION: new PublicKey('B1LMnYAtxvQLFG56YS9vscBFLid7KHp1nWTPYtFKFLPh'),
	CLOSE_POSITION: new PublicKey('49kLMtwwnm5wdCKvtToUYgoxxo9PXjheS1rwcoSYkQfG'),
	SETTLE_COMPETITION: new PublicKey('C1FTdtq531t4MViYtgo7LAft3GRkJimYAhVWFU4BE46i'),
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

export const WORLD_ID = new BN(1);
export const WORLD_INSTANCE_ID = new PublicKey('11111111111111111111111111111111');

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

			this.competitionEntity = FindEntityPda({
				worldId: WORLD_ID,
				entityId: new BN(0),
			});
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

			const args = {
				pair_index: pairIndex,
				direction: direction === PositionDirection.Long ? { Long: {} } : { Short: {} },
				current_price: new BN(priceScaled),
				size: new BN(sizeScaled),
				take_profit: takeProfitScaled ? new BN(takeProfitScaled) : null,
				stop_loss: stopLossScaled ? new BN(stopLossScaled) : null,
			};

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
		await this.connection.confirmTransaction(signature);
		console.log('[MAGICBLOCK] Airdrop confirmed:', signature);
		return signature;
	}

	async getBalance(): Promise<number> {
		if (!this.sessionWallet) {
			return 0;
		}

		const balance = await this.connection.getBalance(this.sessionWallet.publicKey);
		return balance / LAMPORTS_PER_SOL;
	}
}

export const magicBlockClient = new MagicBlockClient();
