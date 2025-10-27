import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL, Transaction, sendAndConfirmTransaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { FindEntityPda, ApplySystem, SerializeArgs, BN, anchor } from '@magicblock-labs/bolt-sdk';
import type { Adapter, SignerWalletAdapter } from '@solana/wallet-adapter-base';

export const MAGICBLOCK_RPC = 'https://rpc.magicblock.app/devnet/';
export const SOLANA_RPC = 'https://api.devnet.solana.com';

// Paper Trading Program ID from the contract
export const PAPER_TRADING_PROGRAM_ID = new PublicKey('b6NjCktqaB4KqTvsNmYTJ9KBfwMJ7Sh4hMJ2Xz26YR3');

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
	async setConnectedWallet(wallet: Adapter | null) {
		this.connectedWallet = wallet;
		console.log('[MAGICBLOCK] Connected wallet set:', wallet?.name || 'None');

		if (wallet?.connected && wallet.publicKey) {
			await this.initializeEntity();
		}
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
			const [userAccountPDA] = this.getUserAccountPDA(currentWallet.publicKey, pairIndex);
			const [configPDA] = this.getConfigPDA();

			const existingAccount = await this.connection.getAccountInfo(userAccountPDA);
			if (existingAccount) {
				return 'account_already_exists';
			}

			const configAccountInfo = await this.connection.getAccountInfo(configPDA);
			if (!configAccountInfo) {
				throw new Error('Config account not initialized. Contact admin.');
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
			const latestBlockhash = await this.connection.getLatestBlockhash('finalized');
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
				try {
					signature = await this.connection.sendRawTransaction(signedTx.serialize(), {
						skipPreflight: false,
						preflightCommitment: 'finalized'
					});
				} catch (error: any) {
					if (error.name === 'SendTransactionError') {
						console.error('[MAGICBLOCK] SendTransactionError details:', error.getLogs?.() || 'No logs available');
						if (error.message?.includes('This transaction has already been processed')) {
							throw new Error('Transaction already processed. Please wait a moment before trying again.');
						}
					}
					throw error;
				}
			} else {
				throw new Error('Wallet does not support transaction signing');
			}

			console.log('[MAGICBLOCK] Account initialized on main chain:', signature);
			
			// Wait for confirmation
			await this.connection.confirmTransaction(signature, 'confirmed');
			
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
		const currentWallet = this.getCurrentWallet();
		if (!currentWallet) return;

		try {
			this.entityPda = FindEntityPda({
				worldId: WORLD_ID,
				seed: Buffer.from(currentWallet.publicKey.toBytes()),
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

	async buySpot(pairIndex: number, usdtAmount: number, currentPrice: number): Promise<string> {
		const currentWallet = this.getCurrentWallet();
		if (!currentWallet) {
			throw new Error('Wallet not connected');
		}

		const costInTokenIn = Math.floor(usdtAmount * 1e6);
		const priceScaled = Math.floor(currentPrice * 1e6);

		const [userAccountPDA] = this.getUserAccountPDA(currentWallet.publicKey, pairIndex);

		const methodName = "global:buy";
		const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(methodName));
		const discriminator = new Uint8Array(hash).slice(0, 8);

		const instructionData = Buffer.alloc(8 + 16);
		Buffer.from(discriminator).copy(instructionData, 0);
		instructionData.writeBigUInt64LE(BigInt(costInTokenIn), 8);
		instructionData.writeBigUInt64LE(BigInt(priceScaled), 16);

		const instruction = new TransactionInstruction({
			keys: [
				{ pubkey: userAccountPDA, isSigner: false, isWritable: true },
				{ pubkey: currentWallet.publicKey, isSigner: true, isWritable: false },
			],
			programId: PAPER_TRADING_PROGRAM_ID,
			data: instructionData
		});

		const transaction = new Transaction().add(instruction);
		const latestBlockhash = await this.connection.getLatestBlockhash('confirmed');
		transaction.recentBlockhash = latestBlockhash.blockhash;
		transaction.feePayer = currentWallet.publicKey;

		const signedTx = await currentWallet.signTransaction!(transaction);
		const signature = await this.connection.sendRawTransaction(signedTx.serialize(), {
			skipPreflight: false,
			preflightCommitment: 'confirmed'
		});

		await this.connection.confirmTransaction({
			signature,
			blockhash: latestBlockhash.blockhash,
			lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
		}, 'confirmed');

		return signature;
	}

	async sellSpot(pairIndex: number, tokenAmount: number, currentPrice: number): Promise<string> {
		const currentWallet = this.getCurrentWallet();
		if (!currentWallet) {
			throw new Error('Wallet not connected');
		}

		const valueInTokenIn = Math.floor(tokenAmount * currentPrice * 1e6);
		const priceScaled = Math.floor(currentPrice * 1e6);

		const [userAccountPDA] = this.getUserAccountPDA(currentWallet.publicKey, pairIndex);

		const methodName = "global:sell";
		const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(methodName));
		const discriminator = new Uint8Array(hash).slice(0, 8);

		const instructionData = Buffer.alloc(8 + 16);
		Buffer.from(discriminator).copy(instructionData, 0);
		instructionData.writeBigUInt64LE(BigInt(valueInTokenIn), 8);
		instructionData.writeBigUInt64LE(BigInt(priceScaled), 16);

		const instruction = new TransactionInstruction({
			keys: [
				{ pubkey: userAccountPDA, isSigner: false, isWritable: true },
				{ pubkey: currentWallet.publicKey, isSigner: true, isWritable: false },
			],
			programId: PAPER_TRADING_PROGRAM_ID,
			data: instructionData
		});

		const transaction = new Transaction().add(instruction);
		const latestBlockhash = await this.connection.getLatestBlockhash('confirmed');
		transaction.recentBlockhash = latestBlockhash.blockhash;
		transaction.feePayer = currentWallet.publicKey;

		const signedTx = await currentWallet.signTransaction!(transaction);
		const signature = await this.connection.sendRawTransaction(signedTx.serialize(), {
			skipPreflight: false,
			preflightCommitment: 'confirmed'
		});

		await this.connection.confirmTransaction({
			signature,
			blockhash: latestBlockhash.blockhash,
			lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
		}, 'confirmed');

		return signature;
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
		
		const priceScaled = Math.floor(currentPrice * 1e6);
		const amountTokenOut = Math.floor((size / currentPrice) * 1e9);
		const requiredTokenIn = Math.floor(size * 1e6);
		const takeProfitScaled = takeProfit ? Math.floor(takeProfit * 1e6) : 0;
		const stopLossScaled = stopLoss ? Math.floor(stopLoss * 1e6) : 0;

		// Check if user has sufficient balance before attempting the transaction
		const accountData = await this.getUserAccountData(pairIndex);
		if (!accountData) {
			throw new Error(`Trading account not found for pair ${pairIndex}. Please initialize first.`);
		}

		const requiredBalance = requiredTokenIn / 1e6; // Convert back to readable format for comparison
		const epsilon = 0.01; // Allow 0.01 USDT tolerance for floating point precision
		console.log('[MAGICBLOCK] Balance check:', {
			available: accountData.tokenInBalance,
			required: requiredBalance,
			difference: accountData.tokenInBalance - requiredBalance,
			size,
			currentPrice
		});

		if (accountData.tokenInBalance < requiredBalance - epsilon) {
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
		instructionData.writeBigUInt64LE(BigInt(amountTokenOut), 8);
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
		
		let signature: string;
		try {
			signature = await this.connection.sendRawTransaction(signedTx.serialize(), {
				skipPreflight: false,
				preflightCommitment: 'confirmed'
			});
		} catch (error: any) {
			if (error.name === 'SendTransactionError') {
				console.error('[MAGICBLOCK] SendTransactionError details:', error.getLogs?.() || 'No logs available');
				if (error.message?.includes('This transaction has already been processed')) {
					// Check if we can extract the signature from the error or transaction
					// If the transaction was already processed, it likely succeeded
					console.log('[MAGICBLOCK] Transaction may have already succeeded, checking...');
					
					// Try to get the signature from the serialized transaction
					try {
						const txSignature = signedTx.signatures[0]?.toString();
						if (txSignature) {
							console.log('[MAGICBLOCK] Found transaction signature:', txSignature);
							// Check transaction status
							const status = await this.connection.getSignatureStatus(txSignature);
							if (status.value?.confirmationStatus) {
								console.log('[MAGICBLOCK] Transaction already confirmed:', txSignature);
								return txSignature;
							}
						}
					} catch (sigError) {
						console.warn('[MAGICBLOCK] Could not check transaction status:', sigError);
					}
					
					throw new Error('Transaction already processed. Please wait a moment before trying again.');
				}
			}
			throw error;
		}

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
		// Use MagicBlock connection only to avoid rate limits
		
		const [userAccountPDA] = this.getUserAccountPDA(currentWallet.publicKey, pairIndex);
		
		// Check if account is initialized
		const accountInfo = await this.connection.getAccountInfo(userAccountPDA);
		if (!accountInfo) {
			throw new Error(`Trading account not initialized for pair ${pairIndex}. Please initialize first.`);
		}

		const priceScaled = Math.floor(currentPrice * 1e6);
		const amountTokenOut = Math.floor((size / currentPrice) * 1e9);
		const requiredTokenIn = Math.floor(size * 1e6);
		const takeProfitScaled = takeProfit ? Math.floor(takeProfit * 1e6) : 0;
		const stopLossScaled = stopLoss ? Math.floor(stopLoss * 1e6) : 0;

		// Check balance using MagicBlock connection
		const accountData = await this.getUserAccountData(pairIndex);
		
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
		instructionData.writeBigUInt64LE(BigInt(amountTokenOut), 8);
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
		const latestBlockhash = await this.connection.getLatestBlockhash('confirmed');
		transaction.recentBlockhash = latestBlockhash.blockhash;
		transaction.feePayer = currentWallet.publicKey;

		console.log('[MAGICBLOCK] Signing direct contract transaction...');
		const signedTx = await currentWallet.signTransaction(transaction);
		
		let signature: string;
		try {
			signature = await this.connection.sendRawTransaction(signedTx.serialize(), {
				skipPreflight: false,
				preflightCommitment: 'confirmed'
			});
		} catch (error: any) {
			if (error.name === 'SendTransactionError') {
				console.error('[MAGICBLOCK] SendTransactionError details:', error.getLogs?.() || 'No logs available');
				if (error.message?.includes('This transaction has already been processed')) {
					// Check if the transaction actually succeeded
					console.log('[MAGICBLOCK] Transaction may have already succeeded, checking...');
					
					try {
						const txSignature = signedTx.signatures[0]?.toString();
						if (txSignature) {
							console.log('[MAGICBLOCK] Found transaction signature:', txSignature);
							const status = await this.connection.getSignatureStatus(txSignature);
							if (status.value?.confirmationStatus) {
								console.log('[MAGICBLOCK] Transaction already confirmed:', txSignature);
								return txSignature;
							}
						}
					} catch (sigError) {
						console.warn('[MAGICBLOCK] Could not check transaction status:', sigError);
					}
					
					throw new Error('Transaction already processed. Please wait a moment before trying again.');
				}
			}
			throw error;
		}

		// Wait for confirmation
		await this.connection.confirmTransaction({
			signature,
			blockhash: latestBlockhash.blockhash,
			lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
		}, 'confirmed');

		console.log('[MAGICBLOCK] Direct contract position opened:', signature);
		return signature;
	}

	async closeDirectPosition(positionPubkey: string, currentPrice: number): Promise<string> {
		const currentWallet = this.getCurrentWallet();
		if (!currentWallet) {
			throw new Error('Wallet not connected');
		}

		console.log('[MAGICBLOCK] Closing direct contract position:', positionPubkey);

		// Use MagicBlock connection only to avoid rate limits
		
		// Get position account to read the data
		const positionAccountPubkey = new PublicKey(positionPubkey);
		const positionAccount = await this.connection.getAccountInfo(positionAccountPubkey);
		if (!positionAccount) {
			throw new Error('Position account not found');
		}

		// Parse position data to get pair_index
		const data = positionAccount.data;
		let offset = 8; // Skip discriminator
		offset += 32; // Skip owner
		const pairIndex = data[offset]; // pair_index

		// Get user account PDA
		const [userAccountPDA] = this.getUserAccountPDA(currentWallet.publicKey, pairIndex);

		// Create the instruction data for close_position
		const methodName = "global:close_position";
		const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(methodName));
		const discriminator = new Uint8Array(hash).slice(0, 8);

		// Create instruction data buffer (discriminator + current_price u64)
		const instructionData = Buffer.alloc(8 + 8); // 8 bytes discriminator + 8 bytes for u64
		Buffer.from(discriminator).copy(instructionData, 0);
		instructionData.writeBigUInt64LE(BigInt(Math.floor(currentPrice * 1e6)), 8); // Price with 6 decimals

		const instruction = new TransactionInstruction({
			keys: [
				{ pubkey: positionAccountPubkey, isSigner: false, isWritable: true },
				{ pubkey: userAccountPDA, isSigner: false, isWritable: true },
				{ pubkey: currentWallet.publicKey, isSigner: true, isWritable: false },
			],
			programId: PAPER_TRADING_PROGRAM_ID,
			data: instructionData
		});

		const transaction = new Transaction().add(instruction);
		
		// Get fresh blockhash
		const latestBlockhash = await this.connection.getLatestBlockhash('confirmed');
		transaction.recentBlockhash = latestBlockhash.blockhash;
		transaction.feePayer = currentWallet.publicKey;

		console.log('[MAGICBLOCK] Signing close position transaction...');
		const signedTx = await currentWallet.signTransaction!(transaction);
		
		let signature: string;
		try {
			signature = await this.connection.sendRawTransaction(signedTx.serialize(), {
				skipPreflight: false,
				preflightCommitment: 'confirmed'
			});
		} catch (error: any) {
			if (error.name === 'SendTransactionError') {
				console.error('[MAGICBLOCK] SendTransactionError details:', error.getLogs?.() || 'No logs available');
				if (error.message?.includes('This transaction has already been processed')) {
					// For close position, this usually means the position was successfully closed
					console.log('[MAGICBLOCK] Close position already processed - treating as success');
					
					try {
						const txSignature = signedTx.signatures[0]?.toString();
						if (txSignature) {
							console.log('[MAGICBLOCK] Returning close position signature:', txSignature);
							return txSignature;
						}
					} catch (sigError) {
						console.warn('[MAGICBLOCK] Could not extract signature:', sigError);
					}
					
					// Return success indicator - position likely closed successfully  
					console.log('[MAGICBLOCK] Position close completed (already processed)');
					return 'close_position_success';
				}
			}
			throw error;
		}

		// Wait for confirmation
		await this.connection.confirmTransaction({
			signature,
			blockhash: latestBlockhash.blockhash,
			lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
		}, 'confirmed');

		console.log('[MAGICBLOCK] Position closed:', signature);
		return signature;
	}

	async executeSpotTrade(
		pairSymbol: string,
		action: 'BUY' | 'SELL',
		currentPrice: number,
		sizeInUSDT: number
	): Promise<string> {
		const currentWallet = this.getCurrentWallet();
		if (!currentWallet) {
			throw new Error('Wallet not connected');
		}

		console.log('[MAGICBLOCK] Executing spot trade:', {
			pair: pairSymbol,
			action,
			price: currentPrice,
			sizeInUSDT,
		});

		const pairIndex = TRADING_PAIRS[pairSymbol as keyof typeof TRADING_PAIRS];
		if (pairIndex === undefined) {
			throw new Error(`Unknown trading pair: ${pairSymbol}`);
		}

		// Check if account is initialized
		const [userAccountPDA] = this.getUserAccountPDA(currentWallet.publicKey, pairIndex);
		const accountInfo = await this.connection.getAccountInfo(userAccountPDA);
		if (!accountInfo) {
			throw new Error(`Trading account not initialized for pair ${pairIndex}. Please initialize first.`);
		}

		const amountTokenOut = Math.floor((sizeInUSDT / currentPrice) * 1e9);
		const priceScaled = Math.floor(currentPrice * 1e6);

		// Check balance before executing trade
		const accountData = await this.getUserAccountData(pairIndex);
		if (!accountData) {
			throw new Error(`Trading account not found for pair ${pairIndex}. Please initialize first.`);
		}

		const requiredTokenAmount = amountTokenOut / 1e9;
		const availableTokenAmount = accountData.tokenOutBalance;

		if (action === 'BUY') {
			const requiredUSDT = sizeInUSDT;
			const availableUSDT = accountData.tokenInBalance;
			console.log(`[MAGICBLOCK] BUY check - Required USDT: ${requiredUSDT}, Available: ${availableUSDT}`);
			if (availableUSDT < requiredUSDT) {
				throw new Error(`Insufficient USDT balance. Required: ${requiredUSDT}, Available: ${availableUSDT.toFixed(2)}`);
			}
		} else {
			console.log(`[MAGICBLOCK] SELL check - Required tokens: ${requiredTokenAmount}, Available: ${availableTokenAmount}`);
			if (availableTokenAmount < requiredTokenAmount) {
				throw new Error(`Insufficient token balance. Required: ${requiredTokenAmount.toFixed(6)}, Available: ${availableTokenAmount.toFixed(6)}`);
			}
		}

		// Create the instruction data for buy/sell
		let methodName: string;
		if (action === 'BUY') {
			methodName = "global:buy";
		} else {
			methodName = "global:sell";
		}

		const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(methodName));
		const discriminator = new Uint8Array(hash).slice(0, 8);

		// Create instruction data buffer (discriminator + amount_token_out u64 + price u64)
		const instructionData = Buffer.alloc(8 + 8 + 8); // 8 bytes discriminator + 8 bytes amount + 8 bytes price
		Buffer.from(discriminator).copy(instructionData, 0);
		instructionData.writeBigUInt64LE(BigInt(amountTokenOut), 8);
		instructionData.writeBigUInt64LE(BigInt(priceScaled), 16);

		const instruction = new TransactionInstruction({
			keys: [
				{ pubkey: userAccountPDA, isSigner: false, isWritable: true },
				{ pubkey: currentWallet.publicKey, isSigner: true, isWritable: true },
			],
			programId: PAPER_TRADING_PROGRAM_ID,
			data: instructionData
		});

		const transaction = new Transaction().add(instruction);
		
		// Get fresh blockhash
		const latestBlockhash = await this.connection.getLatestBlockhash('confirmed');
		transaction.recentBlockhash = latestBlockhash.blockhash;
		transaction.feePayer = currentWallet.publicKey;

		console.log('[MAGICBLOCK] Signing spot trade transaction...');
		const signedTx = await currentWallet.signTransaction!(transaction);
		
		let signature: string;
		try {
			signature = await this.connection.sendRawTransaction(signedTx.serialize(), {
				skipPreflight: false,
				preflightCommitment: 'confirmed'
			});
		} catch (error: any) {
			if (error.name === 'SendTransactionError') {
				console.error('[MAGICBLOCK] SendTransactionError details:', error.getLogs?.() || 'No logs available');
				if (error.message?.includes('This transaction has already been processed')) {
					// For spot trades, this usually means the trade was successful
					console.log('[MAGICBLOCK] Spot trade already processed - treating as success');
					
					try {
						const txSignature = signedTx.signatures[0]?.toString();
						if (txSignature) {
							console.log('[MAGICBLOCK] Returning spot trade signature:', txSignature);
							return txSignature;
						}
					} catch (sigError) {
						console.warn('[MAGICBLOCK] Could not extract signature:', sigError);
					}
					
					// Return success indicator - trade likely completed successfully  
					console.log('[MAGICBLOCK] Spot trade completed (already processed)');
					return 'spot_trade_success';
				}
			}
			throw error;
		}

		// Wait for confirmation
		await this.connection.confirmTransaction({
			signature,
			blockhash: latestBlockhash.blockhash,
			lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
		}, 'confirmed');

		console.log('[MAGICBLOCK] Spot trade completed:', signature);
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
				try {
					signature = await this.connection.sendRawTransaction(signedTx.serialize(), {
						skipPreflight: false,
						preflightCommitment: 'confirmed'
					});
				} catch (error: any) {
					if (error.name === 'SendTransactionError') {
						console.error('[MAGICBLOCK] SendTransactionError details:', error.getLogs?.() || 'No logs available');
						if (error.message?.includes('This transaction has already been processed')) {
							throw new Error('Transaction already processed. Please wait a moment before trying again.');
						}
					}
					throw error;
				}
				
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

		// Fetch direct contract positions using MagicBlock rollup only
		try {
			console.log('[MAGICBLOCK] Fetching contract positions via MagicBlock rollup...');
			console.log('[MAGICBLOCK] Current wallet:', currentWallet.publicKey.toBase58());

			// Use MagicBlock rollup connection - all positions are on the rollup
			console.log('[MAGICBLOCK] Getting all program accounts via MagicBlock rollup...');
			const allAccounts = await this.connection.getProgramAccounts(PAPER_TRADING_PROGRAM_ID);
			console.log('[MAGICBLOCK] Found', allAccounts.length, 'total program accounts via MagicBlock rollup');

			// Debug: check what account sizes we have
			const accountSizes = new Map();
			allAccounts.forEach(account => {
				const size = account.account.data.length;
				accountSizes.set(size, (accountSizes.get(size) || 0) + 1);
			});
			console.log('[MAGICBLOCK] Account sizes found:', Array.from(accountSizes.entries()));

			// Calculate expected sizes for different account types:
			// UserAccount: discriminator(8) + owner(32) + pair_index(1) + token_in_balance(8) + token_out_balance(8) + total_positions(8) + created_at(8)
			const userAccountSize = 80; // From debug: actual size is 80
			// PositionAccount: From debug, actual size is 104 bytes
			const positionAccountSize = 104; // From debug: actual size is 104
			console.log('[MAGICBLOCK] UserAccount size (actual):', userAccountSize);
			console.log('[MAGICBLOCK] PositionAccount size (actual):', positionAccountSize);

			// Filter for position accounts by checking data size and structure
			const directPositions = allAccounts.filter(accountInfo => {
				const data = accountInfo.account.data;
				
				console.log('[MAGICBLOCK] Checking account:', accountInfo.pubkey.toBase58(), 'size:', data.length);
				
				// Check if it matches PositionAccount size
				if (data.length !== positionAccountSize) {
					console.log('[MAGICBLOCK] Size mismatch - not a PositionAccount (expected', positionAccountSize, ')');
					return false;
				}

				// Check if owner matches (skip discriminator, owner starts at offset 8)
				try {
					const ownerBytes = data.subarray(8, 8 + 32);
					const ownerPubkey = new PublicKey(ownerBytes);
					const isOurAccount = ownerPubkey.equals(currentWallet.publicKey);
					
					console.log('[MAGICBLOCK] Account owner:', ownerPubkey.toBase58(), 'matches:', isOurAccount);
					
					return isOurAccount;
				} catch (error) {
					console.warn('[MAGICBLOCK] Failed to parse owner:', error);
					return false;
				}
			});

			for (const accountInfo of directPositions) {
				try {
					// Parse position data from the contract
					const data = accountInfo.account.data;
					const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
					
					// Parse according to PositionAccount struct from main.rs:
					// owner: Pubkey (32), pair_index: u8 (1), position_id: u64 (8)
					// position_type: PositionType (1), amount_token_out: u64 (8)
					// entry_price: u64 (8), take_profit_price: u64 (8), stop_loss_price: u64 (8)
					// status: PositionStatus (1), opened_at: i64 (8), closed_at: i64 (8)
					
					let offset = 8; // Skip discriminator
					
					// owner: Pubkey (32 bytes)
					offset += 32;
					
					// pair_index: u8 (1 byte)
					const pairIndex = data[offset];
					offset += 1;
					
					// position_id: u64 (8 bytes)
					const positionId = dataView.getBigUint64(offset, true);
					offset += 8;
					
					// position_type: PositionType (1 byte) - 0 = Long, 1 = Short  
					const positionType = data[offset];
					offset += 1;
					
					// amount_token_out: u64 (8 bytes)
					const amountTokenOut = dataView.getBigUint64(offset, true);
					offset += 8;
					
					// entry_price: u64 (8 bytes)
					const entryPrice = dataView.getBigUint64(offset, true);
					offset += 8;
					
					// take_profit_price: u64 (8 bytes)
					const takeProfitPrice = dataView.getBigUint64(offset, true);
					offset += 8;
					
					// stop_loss_price: u64 (8 bytes)
					const stopLossPrice = dataView.getBigUint64(offset, true);
					offset += 8;
					
					// status: PositionStatus (1 byte) - 0 = Active, 1 = Closed
					const status = data[offset];
					offset += 1;
					
					// opened_at: i64 (8 bytes)
					const openedAt = dataView.getBigInt64(offset, true);
					offset += 8;
					
					// closed_at: i64 (8 bytes)
					const closedAt = dataView.getBigInt64(offset, true);

					// Get pair symbol
					const pairSymbols = ['SOL', 'BTC', 'ETH', 'AVAX', 'LINK'];
					const pairSymbol = pairSymbols[pairIndex] || 'UNKNOWN';

					if (status === 0) { // Only show active positions
						positions.push({
							type: 'direct',
							pubkey: accountInfo.pubkey.toBase58(),
							positionId: positionId.toString(),
							direction: positionType === 0 ? 'LONG' : 'SHORT',
							pairIndex,
							pairSymbol,
							amountTokenOut: Number(amountTokenOut) / 1e9,
							entryPrice: Number(entryPrice) / 1e6,
							takeProfitPrice: takeProfitPrice > 0 ? Number(takeProfitPrice) / 1e6 : null,
							stopLossPrice: stopLossPrice > 0 ? Number(stopLossPrice) / 1e6 : null,
							openedAt: new Date(Number(openedAt) * 1000),
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

	async joinCompetition(): Promise<string> {
		const currentWallet = this.getCurrentWallet();
		if (!currentWallet || !this.entityPda || !this.competitionEntity) {
			throw new Error('Wallet not connected or entity not initialized');
		}

		console.log('[MAGICBLOCK] Joining competition via Bolt system...');

		try {
			const { transaction } = await ApplySystem({
				authority: currentWallet.publicKey,
				systemId: SYSTEM_IDS.JOIN_COMPETITION,
				entities: [
					{
						entity: this.competitionEntity,
						components: [{ componentId: COMPONENT_IDS.COMPETITION }],
					},
					{
						entity: this.entityPda,
						components: [{ componentId: COMPONENT_IDS.TRADING_ACCOUNT }],
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
				console.log('[MAGICBLOCK] Signing join competition transaction...');
				const signedTx = await currentWallet.signTransaction(transaction);
				try {
					signature = await this.connection.sendRawTransaction(signedTx.serialize(), {
						skipPreflight: false,
						preflightCommitment: 'confirmed'
					});
				} catch (error: any) {
					if (error.name === 'SendTransactionError') {
						console.error('[MAGICBLOCK] SendTransactionError details:', error.getLogs?.() || 'No logs available');
						if (error.message?.includes('This transaction has already been processed')) {
							throw new Error('Transaction already processed. Please wait a moment before trying again.');
						}
					}
					throw error;
				}
				
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

			console.log('[MAGICBLOCK] Competition joined:', signature);
			return signature;
		} catch (error) {
			console.error('[MAGICBLOCK] Failed to join competition:', error);
			throw error;
		}
	}

	async fetchLeaderboard(): Promise<any[]> {
		if (!this.competitionEntity) {
			return [];
		}

		try {
			console.log('[MAGICBLOCK] Fetching leaderboard from competition components...');
			
			const tradingAccountAccounts = await this.connection.getProgramAccounts(COMPONENT_IDS.TRADING_ACCOUNT, {
				filters: [
					{
						memcmp: {
							offset: 8, // Skip discriminator
							bytes: this.competitionEntity.toBase58() // Filter by competition entity
						}
					}
				]
			});

			const leaderboard = [];
			for (const accountInfo of tradingAccountAccounts) {
				try {
					// Parse trading account data
					// This would need to match the TradingAccount component structure
					// const data = accountInfo.account.data;
					// TODO: Add parsing logic based on the actual TradingAccount structure
					
					leaderboard.push({
						address: accountInfo.pubkey.toBase58(),
						pnl: 0, // Parse from actual data structure
						trades: 0, // Parse from actual data structure  
						balance: 10000, // Parse from actual data structure
					});
				} catch (parseError) {
					console.warn('[MAGICBLOCK] Failed to parse trading account:', parseError);
				}
			}

			// Sort by PnL descending
			leaderboard.sort((a, b) => b.pnl - a.pnl);
			
			// Add ranks
			return leaderboard.map((entry, index) => ({
				...entry,
				rank: index + 1
			}));
		} catch (error) {
			console.warn('[MAGICBLOCK] Failed to fetch leaderboard:', error);
			return [];
		}
	}

	async fetchCompetitionData(): Promise<{ startTime: Date; endTime: Date; totalParticipants: number; prizePool: number; isActive: boolean; name: string } | null> {
		if (!this.competitionEntity) {
			return null;
		}

		try {
			console.log('[MAGICBLOCK] Fetching competition data...');

			const [componentPda] = PublicKey.findProgramAddressSync(
				[Buffer.from('component'), this.competitionEntity.toBuffer(), COMPONENT_IDS.COMPETITION.toBuffer()],
				COMPONENT_IDS.COMPETITION
			);

			const accountInfo = await this.connection.getAccountInfo(componentPda);
			if (!accountInfo) {
				console.warn('[MAGICBLOCK] Competition component not found');
				return null;
			}

			const data = accountInfo.data;
			let offset = 8;

			const authorityBytes = data.slice(offset, offset + 32);
			offset += 32;

			const startTimeBuffer = data.slice(offset, offset + 8);
			const startTime = new DataView(startTimeBuffer.buffer, startTimeBuffer.byteOffset).getBigInt64(0, true);
			offset += 8;

			const endTimeBuffer = data.slice(offset, offset + 8);
			const endTime = new DataView(endTimeBuffer.buffer, endTimeBuffer.byteOffset).getBigInt64(0, true);
			offset += 8;

			const totalParticipantsBuffer = data.slice(offset, offset + 8);
			const totalParticipants = new DataView(totalParticipantsBuffer.buffer, totalParticipantsBuffer.byteOffset).getBigUint64(0, true);
			offset += 8;

			const prizePoolBuffer = data.slice(offset, offset + 8);
			const prizePool = new DataView(prizePoolBuffer.buffer, prizePoolBuffer.byteOffset).getBigUint64(0, true);
			offset += 8;

			const isActive = data[offset] === 1;
			offset += 1;

			const nameLength = data.readUInt32LE(offset);
			offset += 4;
			const name = data.slice(offset, offset + nameLength).toString('utf-8');

			return {
				startTime: new Date(Number(startTime) * 1000),
				endTime: new Date(Number(endTime) * 1000),
				totalParticipants: Number(totalParticipants),
				prizePool: Number(prizePool),
				isActive,
				name
			};
		} catch (error) {
			console.error('[MAGICBLOCK] Failed to fetch competition data:', error);
			return null;
		}
	}

	async settleCompetition(): Promise<string> {
		const currentWallet = this.getCurrentWallet();
		if (!currentWallet || !this.competitionEntity) {
			throw new Error('Wallet not connected or competition entity not initialized');
		}

		console.log('[MAGICBLOCK] Settling competition via Bolt system...');

		try {
			const { transaction } = await ApplySystem({
				authority: currentWallet.publicKey,
				systemId: SYSTEM_IDS.SETTLE_COMPETITION,
				entities: [
					{
						entity: this.competitionEntity,
						components: [{ componentId: COMPONENT_IDS.COMPETITION }],
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
				console.log('[MAGICBLOCK] Signing settle competition transaction...');
				const signedTx = await currentWallet.signTransaction(transaction);
				try {
					signature = await this.connection.sendRawTransaction(signedTx.serialize(), {
						skipPreflight: false,
						preflightCommitment: 'confirmed'
					});
				} catch (error: any) {
					if (error.name === 'SendTransactionError') {
						console.error('[MAGICBLOCK] SendTransactionError details:', error.getLogs?.() || 'No logs available');
						if (error.message?.includes('This transaction has already been processed')) {
							throw new Error('Transaction already processed. Please wait a moment before trying again.');
						}
					}
					throw error;
				}
				
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

			console.log('[MAGICBLOCK] Competition settled:', signature);
			return signature;
		} catch (error) {
			console.error('[MAGICBLOCK] Failed to settle competition:', error);
			throw error;
		}
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
