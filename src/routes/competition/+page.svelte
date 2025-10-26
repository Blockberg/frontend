<script lang="ts">
	import { onMount } from 'svelte';

	let currentTime = new Date().toLocaleTimeString();
	let competitionEndTime = new Date(Date.now() + 2538000);
	let timeRemaining = '00:42:18';

	let leaderboard = [
		{ rank: 1, player: '7kDx...w2Qp', balance: 14250.50, pnl: 4250.50, pnlPct: 42.51, trades: 23, volume: 89234, lastTrade: 'LONG SOL @198.50', status: 'ACTIVE' },
		{ rank: 2, player: '9mFg...k5Hn', balance: 13890.25, pnl: 3890.25, pnlPct: 38.90, trades: 19, volume: 72451, lastTrade: 'SHORT BTC @43210', status: 'ACTIVE' },
		{ rank: 3, player: '3bVc...p8Yz', balance: 12675.00, pnl: 2675.00, pnlPct: 26.75, trades: 31, volume: 95123, lastTrade: 'LONG ETH @2234', status: 'ACTIVE' },
		{ rank: 4, player: '5nTr...j4Kl', balance: 11950.75, pnl: 1950.75, pnlPct: 19.51, trades: 15, volume: 45678, lastTrade: 'SHORT SOL @198.20', status: 'ACTIVE' },
		{ rank: 5, player: '8qWx...m7Pb', balance: 11420.00, pnl: 1420.00, pnlPct: 14.20, trades: 28, volume: 78234, lastTrade: 'LONG AVAX @34.50', status: 'ACTIVE' },
		{ rank: 6, player: '2cYz...r3Nm', balance: 10880.50, pnl: 880.50, pnlPct: 8.81, trades: 12, volume: 34567, lastTrade: 'LONG LINK @14.23', status: 'ACTIVE' },
		{ rank: 7, player: '6jKl...v9Qx', balance: 10550.25, pnl: 550.25, pnlPct: 5.50, trades: 18, volume: 52341, lastTrade: 'SHORT BTC @43195', status: 'ACTIVE' },
		{ rank: 8, player: '4dRt...b2Ws', balance: 10120.00, pnl: 120.00, pnlPct: 1.20, trades: 9, volume: 28934, lastTrade: 'LONG SOL @198.15', status: 'ACTIVE' },
		{ rank: 9, player: '1hPq...n8Zx', balance: 9875.50, pnl: -124.50, pnlPct: -1.25, trades: 14, volume: 41234, lastTrade: 'SHORT ETH @2230', status: 'ACTIVE' },
		{ rank: 10, player: '7xMk...t5Cv', balance: 9650.00, pnl: -350.00, pnlPct: -3.50, trades: 11, volume: 35678, lastTrade: 'LONG BTC @43180', status: 'ACTIVE' }
	];

	let recentActivity = [
		{ time: '14:32:18', player: '7kDx...w2Qp', action: 'OPENED', direction: 'LONG', symbol: 'SOL', price: 198.50, size: 500, type: 'ENTRY' },
		{ time: '14:32:15', player: '3bVc...p8Yz', action: 'CLOSED', direction: 'SHORT', symbol: 'BTC', price: 43210, size: 200, pnl: 450, type: 'EXIT' },
		{ time: '14:32:12', player: '9mFg...k5Hn', action: 'OPENED', direction: 'SHORT', symbol: 'BTC', price: 43210, size: 300, type: 'ENTRY' },
		{ time: '14:32:08', player: '5nTr...j4Kl', action: 'CLOSED', direction: 'LONG', symbol: 'ETH', price: 2234, size: 400, pnl: -125, type: 'EXIT' },
		{ time: '14:32:05', player: '8qWx...m7Pb', action: 'OPENED', direction: 'LONG', symbol: 'AVAX', price: 34.50, size: 600, type: 'ENTRY' },
		{ time: '14:32:01', player: '2cYz...r3Nm', action: 'OPENED', direction: 'LONG', symbol: 'LINK', price: 14.23, size: 350, type: 'ENTRY' },
		{ time: '14:31:58', player: '7kDx...w2Qp', action: 'CLOSED', direction: 'SHORT', symbol: 'SOL', price: 198.30, size: 450, pnl: 325, type: 'EXIT' },
		{ time: '14:31:54', player: '6jKl...v9Qx', action: 'OPENED', direction: 'SHORT', symbol: 'BTC', price: 43195, size: 250, type: 'ENTRY' }
	];

	let competitionStats = {
		totalVolume: 1234567,
		totalTrades: 847,
		avgTradeSize: 1458,
		topGainer: '+$4,250.50',
		topLoser: '-$2,134.25',
		mostActive: '31 trades'
	};

	function updateTime() {
		currentTime = new Date().toLocaleTimeString();
		const now = Date.now();
		const diff = competitionEndTime.getTime() - now;
		if (diff > 0) {
			const hours = Math.floor(diff / 3600000);
			const minutes = Math.floor((diff % 3600000) / 60000);
			const seconds = Math.floor((diff % 60000) / 1000);
			timeRemaining = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
		} else {
			timeRemaining = 'ENDED';
		}
	}

	function addRecentActivity() {
		const players = ['7kDx...w2Qp', '9mFg...k5Hn', '3bVc...p8Yz', '5nTr...j4Kl', '8qWx...m7Pb'];
		const symbols = ['SOL', 'BTC', 'ETH', 'AVAX', 'LINK'];
		const directions = ['LONG', 'SHORT'];
		const actions = ['OPENED', 'CLOSED'];

		const newActivity = {
			time: new Date().toLocaleTimeString(),
			player: players[Math.floor(Math.random() * players.length)],
			action: actions[Math.floor(Math.random() * actions.length)],
			direction: directions[Math.floor(Math.random() * directions.length)],
			symbol: symbols[Math.floor(Math.random() * symbols.length)],
			price: Math.random() * 1000 + 100,
			size: Math.floor(Math.random() * 500 + 100),
			pnl: Math.random() > 0.5 ? Math.floor(Math.random() * 500 - 250) : undefined,
			type: Math.random() > 0.5 ? 'ENTRY' : 'EXIT'
		};

		recentActivity = [newActivity, ...recentActivity.slice(0, 19)];
	}

	onMount(() => {
		updateTime();
		const timeInterval = setInterval(updateTime, 1000);
		const activityInterval = setInterval(addRecentActivity, 3000);

		return () => {
			clearInterval(timeInterval);
			clearInterval(activityInterval);
		};
	});
</script>

<div class="bloomberg">
	<div class="command-bar">
		<a href="/" class="logo">BLOCKBERG</a>
		<div class="nav-links">
			<a href="/" class="nav-link">TERMINAL</a>
			<a href="/competition" class="nav-link active">COMPETITION</a>
		</div>
		<div class="status-bar">
			<span class="status-item">COMP #42</span>
			<span class="status-item">TIME: {timeRemaining}</span>
			<span class="status-item">VOL: ${(competitionStats.totalVolume / 1000).toFixed(0)}K</span>
			<span class="status-item">TRADES: {competitionStats.totalTrades}</span>
		</div>
	</div>

	<div class="main-grid">
		<div class="ticker-panel">
			<div class="panel-header">COMPETITION STATS • LIVE</div>
			<div class="ticker-stats">
				<div class="ticker-item">
					<span class="ticker-label">ENTRY</span>
					<span class="ticker-value">0.1 SOL</span>
				</div>
				<div class="ticker-item">
					<span class="ticker-label">PRIZE</span>
					<span class="ticker-value green">15.5 SOL</span>
				</div>
				<div class="ticker-item">
					<span class="ticker-label">BALANCE</span>
					<span class="ticker-value">$10,000</span>
				</div>
				<div class="ticker-item">
					<span class="ticker-label">DURATION</span>
					<span class="ticker-value">60 MIN</span>
				</div>
				<div class="ticker-item">
					<span class="ticker-label">PLAYERS</span>
					<span class="ticker-value">127</span>
				</div>
				<div class="ticker-item">
					<span class="ticker-label">TOP</span>
					<span class="ticker-value green">{competitionStats.topGainer}</span>
				</div>
			</div>
		</div>

		<div class="leaderboard-panel">
			<div class="panel-header">LIVE LEADERBOARD • TOP 10</div>
			<div class="data-table">
				<div class="table-row header">
					<div class="col-rank">RNK</div>
					<div class="col-player">PLAYER</div>
					<div class="col-pnl">P&L</div>
					<div class="col-balance">BALANCE</div>
					<div class="col-trades">TRD</div>
					<div class="col-volume">VOLUME</div>
					<div class="col-last">LAST TRADE</div>
				</div>
				{#each leaderboard as entry}
					<div class="table-row" class:flash={entry.rank === 1}>
						<div class="col-rank rank-{entry.rank}">{entry.rank}</div>
						<div class="col-player">{entry.player}</div>
						<div class="col-pnl" class:green={entry.pnl > 0} class:red={entry.pnl < 0}>
							{entry.pnl > 0 ? '+' : ''}{entry.pnl.toFixed(2)}
						</div>
						<div class="col-balance">${entry.balance.toLocaleString()}</div>
						<div class="col-trades">{entry.trades}</div>
						<div class="col-volume">${(entry.volume / 1000).toFixed(0)}K</div>
						<div class="col-last">{entry.lastTrade}</div>
					</div>
				{/each}
			</div>
		</div>

		<div class="activity-panel">
			<div class="panel-header">TRADE ACTIVITY • LIVE FEED</div>
			<div class="activity-feed">
				{#each recentActivity as activity}
					<div class="activity-row" class:entry={activity.type === 'ENTRY'} class:exit={activity.type === 'EXIT'}>
						<span class="activity-time">{activity.time}</span>
						<span class="activity-player">{activity.player}</span>
						<span class="activity-action {activity.action.toLowerCase()}">{activity.action}</span>
						<span class="activity-direction {activity.direction.toLowerCase()}">{activity.direction}</span>
						<span class="activity-symbol">{activity.symbol}</span>
						<span class="activity-price">@{activity.price.toFixed(2)}</span>
						<span class="activity-size">{activity.size}</span>
						{#if activity.pnl !== undefined}
							<span class="activity-pnl" class:green={activity.pnl > 0} class:red={activity.pnl < 0}>
								{activity.pnl > 0 ? '+' : ''}{activity.pnl}
							</span>
						{/if}
					</div>
				{/each}
			</div>
		</div>

		<div class="join-panel">
			<div class="nft-info">
				<div class="nft-header">NFT TROPHY REWARDS</div>
				<div class="nft-tiers">
					<div class="nft-tier">
						<div class="tier-rank gold">1ST PLACE</div>
						<div class="tier-prize">GOLD TROPHY NFT + 50% PRIZE POOL</div>
						<div class="tier-details">Legendary • Animated • Transferable • On-Chain Verified</div>
					</div>
					<div class="nft-tier">
						<div class="tier-rank silver">2ND PLACE</div>
						<div class="tier-prize">SILVER TROPHY NFT + 30% PRIZE POOL</div>
						<div class="tier-details">Epic • Animated • Transferable • On-Chain Verified</div>
					</div>
					<div class="nft-tier">
						<div class="tier-rank bronze">3RD PLACE</div>
						<div class="tier-prize">BRONZE TROPHY NFT + 20% PRIZE POOL</div>
						<div class="tier-details">Rare • Animated • Transferable • On-Chain Verified</div>
					</div>
				</div>
				<div class="nft-footer">
					All NFT trophies are minted on-chain and stored permanently in your wallet. Each trophy includes competition stats, timestamp, and leaderboard placement verification.
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	.bloomberg {
		min-height: 100vh;
		background: #000;
		color: #fff;
		font-family: 'Courier New', monospace;
	}

	.command-bar {
		background: #1a1a1a;
		padding: 8px 15px;
		display: flex;
		align-items: center;
		gap: 15px;
		border-bottom: 1px solid #333;
	}

	.logo {
		font-size: 18px;
		font-weight: bold;
		color: #ff9500;
		letter-spacing: 2px;
		text-decoration: none;
	}

	.nav-links {
		display: flex;
		gap: 15px;
	}

	.nav-link {
		color: #666;
		text-decoration: none;
		font-size: 13px;
		padding: 4px 10px;
		border: 1px solid transparent;
		transition: all 0.2s;
	}

	.nav-link:hover {
		color: #fff;
		border-color: #333;
	}

	.nav-link.active {
		color: #ff9500;
		border-color: #ff9500;
	}

	.status-bar {
		display: flex;
		gap: 20px;
		margin-left: auto;
		font-size: 12px;
	}

	.status-item {
		color: #ff9500;
		padding: 3px 8px;
		background: #000;
		border: 1px solid #333;
	}

	.main-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		grid-template-rows: auto 1fr auto;
		gap: 1px;
		background: #333;
		height: calc(100vh - 40px);
	}

	.ticker-panel {
		grid-column: 1 / -1;
		background: #000;
		border-bottom: 1px solid #333;
	}

	.panel-header {
		background: #1a1a1a;
		padding: 6px 12px;
		border-bottom: 1px solid #ff9500;
		font-size: 11px;
		font-weight: bold;
		letter-spacing: 1px;
		color: #ff9500;
	}

	.ticker-stats {
		display: flex;
		gap: 1px;
		background: #111;
	}

	.ticker-item {
		flex: 1;
		padding: 12px;
		background: #000;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.ticker-label {
		font-size: 10px;
		color: #666;
	}

	.ticker-value {
		font-size: 16px;
		color: #fff;
	}

	.ticker-value.green {
		color: #00ff00;
	}

	.leaderboard-panel {
		background: #000;
		overflow-y: auto;
	}

	.data-table {
		font-size: 11px;
	}

	.table-row {
		display: grid;
		grid-template-columns: 40px 120px 100px 120px 50px 80px 1fr;
		gap: 8px;
		padding: 8px 12px;
		border-bottom: 1px solid #111;
	}

	.table-row.header {
		background: #1a1a1a;
		color: #666;
		font-weight: bold;
		position: sticky;
		top: 0;
		z-index: 10;
		border-bottom: 1px solid #ff9500;
	}

	.table-row:not(.header):hover {
		background: #0a0a0a;
	}

	.table-row.flash {
		animation: pulse 2s infinite;
	}

	@keyframes pulse {
		0%, 100% { background: #000; }
		50% { background: #1a1a00; }
	}

	.col-rank {
		color: #ff9500;
		font-weight: bold;
	}

	.col-rank.rank-1 { color: #ffaa00; }
	.col-rank.rank-2 { color: #aaaaaa; }
	.col-rank.rank-3 { color: #cd7f32; }

	.col-player {
		color: #00ccff;
	}

	.green {
		color: #00ff00;
	}

	.red {
		color: #ff0000;
	}

	.activity-panel {
		background: #000;
		overflow-y: auto;
	}

	.activity-feed {
		font-size: 10px;
	}

	.activity-row {
		display: grid;
		grid-template-columns: 80px 120px 80px 60px 60px 90px 60px 80px;
		gap: 8px;
		padding: 6px 12px;
		border-bottom: 1px solid #0a0a0a;
		transition: background 0.3s;
	}

	.activity-row:nth-child(1) {
		background: #0a0a00;
	}

	.activity-row:hover {
		background: #1a1a1a;
	}

	.activity-time {
		color: #666;
	}

	.activity-player {
		color: #00ccff;
	}

	.activity-action.opened {
		color: #00ff00;
	}

	.activity-action.closed {
		color: #ff9500;
	}

	.activity-direction.long {
		color: #00ff00;
	}

	.activity-direction.short {
		color: #ff0000;
	}

	.activity-symbol {
		color: #fff;
		font-weight: bold;
	}

	.activity-price {
		color: #ffaa00;
	}

	.activity-size {
		color: #999;
	}

	.activity-pnl {
		font-weight: bold;
	}

	.join-panel {
		grid-column: 1 / -1;
		background: #000;
		padding: 15px;
		border-top: 2px solid #ff9500;
	}

	.nft-info {
		background: #0a0a0a;
		border: 1px solid #333;
		padding: 15px;
	}

	.nft-header {
		color: #ff9500;
		font-size: 13px;
		margin-bottom: 12px;
		letter-spacing: 1px;
		border-bottom: 1px solid #333;
		padding-bottom: 8px;
	}

	.nft-tiers {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 12px;
		margin-bottom: 12px;
	}

	.nft-tier {
		background: #000;
		border: 1px solid #222;
		padding: 10px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.tier-rank {
		font-size: 11px;
		padding: 4px 6px;
		text-align: center;
	}

	.tier-rank.gold {
		background: linear-gradient(180deg, #ffaa00 0%, #ff8800 100%);
		color: #000;
	}

	.tier-rank.silver {
		background: linear-gradient(180deg, #cccccc 0%, #888888 100%);
		color: #000;
	}

	.tier-rank.bronze {
		background: linear-gradient(180deg, #cd7f32 0%, #8b5a2b 100%);
		color: #000;
	}

	.tier-prize {
		font-size: 10px;
		color: #fff;
	}

	.tier-details {
		font-size: 8px;
		color: #666;
		line-height: 1.4;
	}

	.nft-footer {
		font-size: 9px;
		color: #999;
		line-height: 1.5;
		padding-top: 10px;
		border-top: 1px solid #222;
	}
</style>
