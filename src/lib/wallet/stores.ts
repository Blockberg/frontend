import { writable } from 'svelte/store';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import type { Adapter, WalletName, SignerWalletAdapter } from '@solana/wallet-adapter-base';

// Wallet state store
export const walletStore = writable<{
	adapter: Adapter | null;
	connected: boolean;
	connecting: boolean;
	publicKey: PublicKey | null;
	wallet: Adapter | null;
}>({
	adapter: null,
	connected: false,
	connecting: false,
	publicKey: null,
	wallet: null
});

export const connectionStore = writable<Connection | null>(null);

// Global wallet management
class WalletManager {
	private connection: Connection;
	private wallets: Adapter[] = [];
	private selectedWallet: Adapter | null = null;

	constructor() {
		const endpoint = 'https://rpc.magicblock.app/devnet';
		this.connection = new Connection(endpoint, 'confirmed');
		connectionStore.set(this.connection);

		// Initialize wallet adapters
		this.wallets = [
			new PhantomWalletAdapter(),
			new SolflareWalletAdapter()
		];

		console.log('[WALLET] Wallet manager initialized');
	}

	getWallets() {
		return this.wallets;
	}

	async connect(walletName?: WalletName) {
		try {
			walletStore.update(state => ({ ...state, connecting: true }));

			let adapter: Adapter;
			
			if (walletName) {
				const foundAdapter = this.wallets.find(w => w.name === walletName);
				if (!foundAdapter) {
					throw new Error(`Wallet ${walletName} not found`);
				}
				adapter = foundAdapter;
			} else {
				// Default to Phantom if no wallet specified
				adapter = this.wallets.find(w => w.name === 'Phantom') || this.wallets[0];
			}

			this.selectedWallet = adapter;

			// Setup event listeners
			adapter.on('connect', () => {
				console.log('[WALLET] Connected to', adapter.name);
				walletStore.update(state => ({
					...state,
					adapter,
					connected: true,
					connecting: false,
					publicKey: adapter.publicKey,
					wallet: adapter
				}));
				// Save wallet selection
				localStorage.setItem('solana-wallet', adapter.name);
			});

			adapter.on('disconnect', () => {
				console.log('[WALLET] Disconnected from', adapter.name);
				walletStore.update(state => ({
					...state,
					adapter: null,
					connected: false,
					connecting: false,
					publicKey: null,
					wallet: null
				}));
				localStorage.removeItem('solana-wallet');
			});

			adapter.on('error', (error) => {
				console.error('[WALLET] Error:', error);
				walletStore.update(state => ({ ...state, connecting: false }));
			});

			// Connect to wallet
			await adapter.connect();

		} catch (error) {
			console.error('[WALLET] Failed to connect:', error);
			walletStore.update(state => ({ ...state, connecting: false }));
			throw error;
		}
	}

	async disconnect() {
		if (this.selectedWallet) {
			try {
				await this.selectedWallet.disconnect();
				this.selectedWallet = null;
			} catch (error) {
				console.error('[WALLET] Failed to disconnect:', error);
			}
		}
	}

	async signTransaction(transaction: Transaction) {
		if (!this.selectedWallet?.connected) {
			throw new Error('Wallet not connected');
		}
		
		const signerWallet = this.selectedWallet as SignerWalletAdapter;
		if (!signerWallet.signTransaction) {
			throw new Error('Wallet does not support signing transactions');
		}
		
		return await signerWallet.signTransaction(transaction);
	}

	async signAllTransactions(transactions: Transaction[]) {
		if (!this.selectedWallet?.connected) {
			throw new Error('Wallet not connected');
		}
		
		const signerWallet = this.selectedWallet as SignerWalletAdapter;
		if (!signerWallet.signAllTransactions) {
			throw new Error('Wallet does not support signing multiple transactions');
		}
		
		return await signerWallet.signAllTransactions(transactions);
	}

	async autoConnect() {
		const savedWallet = localStorage.getItem('solana-wallet');
		if (savedWallet) {
			try {
				await this.connect(savedWallet as WalletName);
			} catch (error) {
				console.log('[WALLET] Auto-connect failed:', error);
				localStorage.removeItem('solana-wallet');
			}
		}
	}
}

export const walletManager = new WalletManager();