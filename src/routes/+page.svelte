<script lang="ts">
	import { onMount } from 'svelte';

	let news: any[] = [];
	let prices = { SOL: { price: 0, change: 0 }, BTC: { price: 0, change: 0 }, ETH: { price: 0, change: 0 } };
	let ws: WebSocket | null = null;
	let command = '';
	let selectedTab = 'SOL';
	let positionSize = '100';
	let takeProfit = '';
	let stopLoss = '';
	let activePositions: any[] = [];
	let totalPnL = 0;
	let totalTrades = 0;
	let winningTrades = 0;
	let currentTime = new Date().toLocaleTimeString();
	let competitionEndTime = new Date(Date.now() + 3600000);
	let timeRemaining = '';
	let newsLoading = true;
	let leaderboardData = [
		{ rank: 1, address: '0x7a2e9f...3f4b', pnl: 12450.00, trades: 47 },
		{ rank: 2, address: '0x9b1c4a...8c2d', pnl: 8230.50, trades: 32 },
		{ rank: 3, address: '0x4d5f8e...1a9c', pnl: 5670.25, trades: 28 },
		{ rank: 4, address: '0x2c8b3f...7e1a', pnl: 3120.00, trades: 19 },
		{ rank: 5, address: '0x6f2a9d...4c8b', pnl: -1450.75, trades: 15 },
	];

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

	async function fetchNews() {
		newsLoading = true;
		try {
			console.log('[NEWS API] Fetching latest crypto news from CryptoCompare...');
			const response = await fetch('https://min-api.cryptocompare.com/data/v2/news/?lang=EN&categories=BTC,ETH,SOL');

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			const data = await response.json();

			if (data.Data && data.Data.length > 0) {
				news = data.Data.slice(0, 30);
				console.log(`[NEWS API] SUCCESS: Loaded ${news.length} articles`);
			} else {
				console.warn('[NEWS API] No news data received');
			}
		} catch (error) {
			console.error('[NEWS API] ERROR: Failed to fetch news:', error);
			news = [];
		} finally {
			newsLoading = false;
		}
	}

	function connectPriceStream() {
		console.log('[WEBSOCKET] Connecting to Binance real-time price streams...');
		const streams = ['solusdt@ticker', 'btcusdt@ticker', 'ethusdt@ticker'];

		ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams.join('/')}`);

		ws.onopen = () => {
			console.log('[WEBSOCKET] SUCCESS: Connected to Binance price feeds');
		};

		ws.onerror = (error) => {
			console.error('[WEBSOCKET] ERROR: Connection failed', error);
		};

		ws.onclose = () => {
			console.log('[WEBSOCKET] Connection closed');
		};

		ws.onmessage = (event) => {
			const message = JSON.parse(event.data);
			const data = message.data;

			if (data && data.e === '24hrTicker') {
				const change = parseFloat(data.P);
				const price = parseFloat(data.c);

				if (data.s === 'SOLUSDT') {
					prices.SOL = { price, change };
				}
				if (data.s === 'BTCUSDT') {
					prices.BTC = { price, change };
				}
				if (data.s === 'ETHUSDT') {
					prices.ETH = { price, change };
				}
				prices = prices;
			}
		};
	}

	function executeCommand() {
		const cmd = command.toUpperCase();
		if (cmd.includes('SOL')) selectedTab = 'SOL';
		else if (cmd.includes('BTC')) selectedTab = 'BTC';
		else if (cmd.includes('ETH')) selectedTab = 'ETH';
		command = '';
	}

	function openPosition(direction: 'LONG' | 'SHORT') {
		const currentPrice = prices[selectedTab].price;
		const size = parseFloat(positionSize);

		if (!size || size <= 0) {
			alert('Invalid position size');
			return;
		}

		const position = {
			id: Date.now(),
			symbol: selectedTab,
			direction,
			entryPrice: currentPrice,
			size,
			takeProfit: takeProfit ? parseFloat(takeProfit) : null,
			stopLoss: stopLoss ? parseFloat(stopLoss) : null,
			timestamp: new Date().toLocaleTimeString(),
			pnl: 0
		};

		activePositions = [...activePositions, position];
		positionSize = '100';
		takeProfit = '';
		stopLoss = '';
	}

	function closePosition(id: number) {
		const position = activePositions.find(p => p.id === id);
		if (!position) return;

		const currentPrice = prices[position.symbol].price;
		const pnl = position.direction === 'LONG'
			? ((currentPrice - position.entryPrice) / position.entryPrice) * position.size
			: ((position.entryPrice - currentPrice) / position.entryPrice) * position.size;

		totalPnL += pnl;
		totalTrades += 1;
		if (pnl > 0) winningTrades += 1;

		const playerExists = leaderboardData.find(p => p.address === 'YOU (Paper)');
		if (playerExists) {
			playerExists.pnl = totalPnL;
			playerExists.trades = totalTrades;
		} else {
			leaderboardData = [
				...leaderboardData,
				{ rank: 0, address: 'YOU (Paper)', pnl: totalPnL, trades: totalTrades }
			];
		}

		leaderboardData.sort((a, b) => b.pnl - a.pnl);
		leaderboardData = leaderboardData.map((item, index) => ({ ...item, rank: index + 1 }));

		console.log(`Closed ${position.direction} ${position.symbol} - P&L: $${pnl.toFixed(2)}`);
		activePositions = activePositions.filter(p => p.id !== id);
	}

	$: {
		activePositions = activePositions.map(position => {
			const currentPrice = prices[position.symbol].price;
			const pnl = position.direction === 'LONG'
				? ((currentPrice - position.entryPrice) / position.entryPrice) * position.size
				: ((position.entryPrice - currentPrice) / position.entryPrice) * position.size;

			if (position.takeProfit &&
				((position.direction === 'LONG' && currentPrice >= position.takeProfit) ||
				 (position.direction === 'SHORT' && currentPrice <= position.takeProfit))) {
				setTimeout(() => closePosition(position.id), 0);
			}

			if (position.stopLoss &&
				((position.direction === 'LONG' && currentPrice <= position.stopLoss) ||
				 (position.direction === 'SHORT' && currentPrice >= position.stopLoss))) {
				setTimeout(() => closePosition(position.id), 0);
			}

			return { ...position, pnl };
		});
	}

	onMount(async () => {
		console.log('[APP] Initializing Blockberg Terminal...');

		fetchNews();
		connectPriceStream();
		updateTime();

		setInterval(fetchNews, 300000);
		setInterval(updateTime, 1000);

		console.log('[APP] Blockberg Terminal ready');

		return () => {
			ws?.close();
		};
	});
</script>

<div class="bloomberg">
	<div class="command-bar">
		<div class="logo">BLOCKBERG</div>
		<input
			type="text"
			bind:value={command}
			on:keydown={(e) => e.key === 'Enter' && executeCommand()}
			placeholder="Type command and press GO"
			class="command-input"
		/>
		<button class="go-button" on:click={executeCommand}>GO</button>
		<div class="competition-timer">
			<span class="timer-label">ROUND ENDS:</span>
			<span class="timer-value">{timeRemaining}</span>
		</div>
		<div class="clock">{currentTime}</div>
	</div>

	<div class="ticker-bar">
		<div class="ticker-item">
			SOL/USD <span class="price">{prices.SOL.price.toFixed(2)}</span>
			<span class={prices.SOL.change >= 0 ? 'change-up' : 'change-down'}>
				{prices.SOL.change >= 0 ? '▲' : '▼'} {Math.abs(prices.SOL.change).toFixed(2)}%
			</span>
		</div>
		<div class="ticker-item">
			BTC/USD <span class="price">{prices.BTC.price.toFixed(2)}</span>
			<span class={prices.BTC.change >= 0 ? 'change-up' : 'change-down'}>
				{prices.BTC.change >= 0 ? '▲' : '▼'} {Math.abs(prices.BTC.change).toFixed(2)}%
			</span>
		</div>
		<div class="ticker-item">
			ETH/USD <span class="price">{prices.ETH.price.toFixed(2)}</span>
			<span class={prices.ETH.change >= 0 ? 'change-up' : 'change-down'}>
				{prices.ETH.change >= 0 ? '▲' : '▼'} {Math.abs(prices.ETH.change).toFixed(2)}%
			</span>
		</div>
	</div>

	<div class="tabs">
		<button class="tab" class:active={selectedTab === 'SOL'} on:click={() => selectedTab = 'SOL'}>SOL EQUITY</button>
		<button class="tab" class:active={selectedTab === 'BTC'} on:click={() => selectedTab = 'BTC'}>BTC EQUITY</button>
		<button class="tab" class:active={selectedTab === 'ETH'} on:click={() => selectedTab = 'ETH'}>ETH EQUITY</button>
		<button class="tab">NEWS</button>
		<button class="tab">LEADERBOARD</button>
	</div>

	<div class="main-grid">
		<div class="panel news-panel">
			<div class="panel-header">TOP NEWS - CRYPTO</div>
			<div class="news-list">
				{#if newsLoading}
					<div class="loading-state">Loading news from CryptoCompare API...</div>
				{:else if news.length === 0}
					<div class="error-state">Failed to load news. Check console for details.</div>
				{:else}
					{#each news as article, i}
						<a href={article.url} target="_blank" rel="noopener noreferrer" class="news-item">
							<div class="news-meta">
								<span class="news-number">{i + 1}</span>
								<span class="news-time">{new Date(article.published_on * 1000).toLocaleTimeString()}</span>
								<span class="news-source">{article.source}</span>
							</div>
							<div class="news-title">{article.title}</div>
						</a>
					{/each}
				{/if}
			</div>
		</div>

		<div class="panel chart-panel">
			<div class="panel-header">
				{selectedTab}/USDT PRICE CHART
				<span class="chart-stats">
					LAST: <span class="price">${prices[selectedTab].price.toFixed(2)}</span>
					<span class={prices[selectedTab].change >= 0 ? 'change-up' : 'change-down'}>
						{prices[selectedTab].change >= 0 ? '▲' : '▼'} {Math.abs(prices[selectedTab].change).toFixed(2)}%
					</span>
				</span>
			</div>
			<div class="chart-container">
				<iframe
					src="https://s.tradingview.com/widgetembed/?frameElementId=tradingview_chart&symbol=BINANCE:{selectedTab}USDT&interval=15&hidesidetoolbar=1&hidetoptoolbar=0&symboledit=0&saveimage=0&toolbarbg=0a0a0a&studies=[]&theme=dark&style=1&timezone=Etc/UTC&withdateranges=1&studies_overrides={{}}&overrides={{'mainSeriesProperties.candleStyle.upColor':'00ff00','mainSeriesProperties.candleStyle.downColor':'ff0000','mainSeriesProperties.candleStyle.borderUpColor':'00ff00','mainSeriesProperties.candleStyle.borderDownColor':'ff0000','mainSeriesProperties.candleStyle.wickUpColor':'00ff00','mainSeriesProperties.candleStyle.wickDownColor':'ff0000','paneProperties.background':'0a0a0a','paneProperties.vertGridProperties.color':'1a1a1a','paneProperties.horzGridProperties.color':'1a1a1a','scalesProperties.textColor':'ff9500'}}&enabled_features=[]&disabled_features=[]&locale=en&utm_source=localhost&utm_medium=widget&utm_campaign=chart&utm_term=BINANCE:{selectedTab}USDT"
					style="width: 100%; height: 100%; border: none;"
					title="{selectedTab} Chart"
				></iframe>
			</div>

			<div class="trading-panel">
				<div class="trading-controls">
					<div class="input-group">
						<label>SIZE (USD)</label>
						<input type="number" bind:value={positionSize} placeholder="100" />
					</div>
					<div class="input-group">
						<label>TAKE PROFIT</label>
						<input type="number" bind:value={takeProfit} placeholder="Optional" />
					</div>
					<div class="input-group">
						<label>STOP LOSS</label>
						<input type="number" bind:value={stopLoss} placeholder="Optional" />
					</div>
				</div>
				<div class="trading-buttons">
					<button class="buy-button" on:click={() => openPosition('LONG')}>
						BUY / LONG
					</button>
					<button class="sell-button" on:click={() => openPosition('SHORT')}>
						SELL / SHORT
					</button>
				</div>
			</div>

			{#if activePositions.length > 0}
				<div class="positions-panel">
					<div class="positions-header">ACTIVE POSITIONS</div>
					{#each activePositions as position}
						<div class="position-row">
							<div class="position-info">
								<span class="position-direction" class:long={position.direction === 'LONG'} class:short={position.direction === 'SHORT'}>
									{position.direction}
								</span>
								<span>{position.symbol}</span>
								<span class="position-size">${position.size}</span>
							</div>
							<div class="position-details">
								<span>Entry: ${position.entryPrice.toFixed(2)}</span>
								<span class={position.pnl >= 0 ? 'pnl-up' : 'pnl-down'}>
									P&L: ${position.pnl.toFixed(2)}
								</span>
							</div>
							<button class="close-button" on:click={() => closePosition(position.id)}>CLOSE</button>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<div class="panel leaderboard-panel">
			<div class="panel-header">
				COMPETITION LEADERBOARD
				<span class="leaderboard-stats">
					<span>WIN RATE: {totalTrades > 0 ? ((winningTrades / totalTrades) * 100).toFixed(1) : 0}%</span>
					<span class={totalPnL >= 0 ? 'pnl-up' : 'pnl-down'}>
						YOUR P&L: ${totalPnL.toFixed(2)}
					</span>
				</span>
			</div>
			<div class="leaderboard-table">
				<div class="table-header">
					<span>RANK</span>
					<span>TRADER</span>
					<span>P&L</span>
					<span>TRADES</span>
				</div>
				{#each leaderboardData as leader}
					<div class="leader-row" class:highlight={leader.address === 'YOU (Paper)'}>
						<span class="rank">{leader.rank}</span>
						<span class="address">{leader.address}</span>
						<span class={leader.pnl >= 0 ? 'pnl-up' : 'pnl-down'}>
							{leader.pnl >= 0 ? '+' : ''}${leader.pnl.toFixed(2)}
						</span>
						<span>{leader.trades}</span>
					</div>
				{/each}
			</div>
		</div>
	</div>
</div>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		background: #000;
		color: #ff9500;
		font-family: 'Courier New', 'Lucida Console', monospace;
		overflow: hidden;
	}

	.bloomberg {
		min-height: 100vh;
		background: #000;
		display: flex;
		flex-direction: column;
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
	}

	.command-input {
		flex: 1;
		background: #000;
		border: 1px solid #ff9500;
		color: #ff9500;
		padding: 6px 12px;
		font-family: 'Courier New', monospace;
		font-size: 13px;
	}

	.command-input::placeholder {
		color: #664000;
	}

	.go-button {
		background: #00cc00;
		color: #000;
		border: none;
		padding: 6px 20px;
		font-weight: bold;
		font-size: 14px;
		cursor: pointer;
		font-family: inherit;
	}

	.go-button:hover {
		background: #00ff00;
	}

	.competition-timer {
		display: flex;
		align-items: center;
		gap: 8px;
		color: #ff9500;
		font-size: 12px;
		padding: 4px 12px;
		background: #000;
		border: 1px solid #333;
	}

	.timer-label {
		color: #666;
		font-size: 10px;
		letter-spacing: 0.5px;
	}

	.timer-value {
		color: #00ff00;
		font-weight: bold;
		font-family: 'Courier New', monospace;
	}

	.clock {
		color: #ff9500;
		font-size: 13px;
		min-width: 100px;
		text-align: right;
	}

	.ticker-bar {
		background: #0a0a0a;
		padding: 8px 15px;
		display: flex;
		gap: 40px;
		border-bottom: 1px solid #333;
	}

	.ticker-item {
		font-size: 13px;
		color: #ff9500;
		display: flex;
		gap: 10px;
		align-items: center;
	}

	.price {
		color: #fff;
		font-weight: bold;
	}

	.change-up {
		color: #00ff00;
		font-size: 12px;
	}

	.change-down {
		color: #ff0000;
		font-size: 12px;
	}

	.tabs {
		background: #0a0a0a;
		display: flex;
		gap: 2px;
		padding: 0 15px;
		border-bottom: 1px solid #333;
	}

	.tab {
		background: #1a1a1a;
		color: #ff9500;
		border: none;
		padding: 8px 20px;
		font-family: 'Courier New', monospace;
		font-size: 12px;
		cursor: pointer;
		border-top: 2px solid transparent;
		transition: all 0.2s ease;
	}

	.tab.active {
		background: #000;
		border-top-color: #ff9500;
		color: #fff;
	}

	.tab:hover {
		background: #000;
	}

	.main-grid {
		display: grid;
		grid-template-columns: 350px 1fr 300px;
		gap: 2px;
		background: #111;
		flex: 1;
		overflow: hidden;
	}

	.panel {
		background: #000;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.panel-header {
		background: #1a1a1a;
		color: #ff9500;
		padding: 8px 12px;
		font-size: 11px;
		font-weight: bold;
		letter-spacing: 1px;
		border-bottom: 1px solid #333;
		display: flex;
		align-items: center;
	}

	.news-list {
		overflow-y: auto;
		padding: 10px;
	}

	.loading-state,
	.error-state {
		padding: 20px;
		text-align: center;
		color: #666;
		font-size: 12px;
	}

	.error-state {
		color: #ff0000;
	}

	.news-item {
		display: block;
		padding: 10px 0;
		border-bottom: 1px solid #1a1a1a;
		transition: background 0.2s ease;
		cursor: pointer;
		text-decoration: none;
		color: inherit;
	}

	.news-item:hover {
		background: #0a0a0a;
		padding-left: 8px;
	}

	.news-meta {
		display: flex;
		gap: 10px;
		margin-bottom: 5px;
		font-size: 10px;
		color: #666;
	}

	.news-number {
		color: #ff9500;
		font-weight: bold;
	}

	.news-title {
		color: #fff;
		font-size: 12px;
		line-height: 1.5;
	}

	.chart-container {
		flex: 1;
		background: #0a0a0a;
		position: relative;
		min-height: 400px;
		width: 100%;
	}

	.chart-stats {
		margin-left: auto;
		display: flex;
		gap: 15px;
		align-items: center;
		font-size: 11px;
	}

	.trading-panel {
		background: #0a0a0a;
		padding: 12px;
		border-top: 1px solid #333;
	}

	.trading-controls {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 10px;
		margin-bottom: 12px;
	}

	.input-group {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.input-group label {
		color: #ff9500;
		font-size: 10px;
		font-weight: bold;
		letter-spacing: 0.5px;
	}

	.input-group input {
		background: #000;
		border: 1px solid #333;
		color: #fff;
		padding: 6px 8px;
		font-family: 'Courier New', monospace;
		font-size: 12px;
	}

	.input-group input:focus {
		outline: none;
		border-color: #ff9500;
	}

	.trading-buttons {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}

	.buy-button,
	.sell-button {
		padding: 10px;
		font-family: 'Courier New', monospace;
		font-size: 13px;
		font-weight: bold;
		border: none;
		cursor: pointer;
		letter-spacing: 1px;
		transition: all 0.15s ease;
	}

	.buy-button {
		background: #00cc00;
		color: #000;
	}

	.buy-button:hover {
		background: #00ff00;
		transform: translateY(-1px);
		box-shadow: 0 2px 8px rgba(0, 255, 0, 0.3);
	}

	.sell-button {
		background: #cc0000;
		color: #fff;
	}

	.sell-button:hover {
		background: #ff0000;
		transform: translateY(-1px);
		box-shadow: 0 2px 8px rgba(255, 0, 0, 0.3);
	}

	.positions-panel {
		background: #000;
		border-top: 1px solid #333;
		padding: 8px;
	}

	.positions-header {
		color: #ff9500;
		font-size: 10px;
		font-weight: bold;
		letter-spacing: 1px;
		margin-bottom: 8px;
		padding: 4px 0;
	}

	.position-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px;
		border: 1px solid #333;
		margin-bottom: 6px;
		font-size: 11px;
		background: #0a0a0a;
	}

	.position-info {
		display: flex;
		gap: 10px;
		align-items: center;
	}

	.position-direction {
		font-weight: bold;
		padding: 2px 6px;
		font-size: 10px;
	}

	.position-direction.long {
		background: #00cc00;
		color: #000;
	}

	.position-direction.short {
		background: #cc0000;
		color: #fff;
	}

	.position-size {
		color: #ff9500;
		font-weight: bold;
	}

	.position-details {
		display: flex;
		gap: 15px;
		color: #fff;
	}

	.close-button {
		background: #333;
		color: #ff9500;
		border: none;
		padding: 4px 12px;
		font-family: 'Courier New', monospace;
		font-size: 10px;
		font-weight: bold;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.close-button:hover {
		background: #ff9500;
		color: #000;
		transform: scale(1.05);
	}

	.leaderboard-stats {
		margin-left: auto;
		display: flex;
		gap: 15px;
		align-items: center;
		font-size: 10px;
		font-weight: normal;
	}

	.leaderboard-table {
		padding: 10px;
		overflow-y: auto;
	}

	.table-header {
		display: grid;
		grid-template-columns: 50px 1fr 100px 60px;
		gap: 10px;
		padding: 8px;
		color: #ff9500;
		font-size: 10px;
		font-weight: bold;
		border-bottom: 1px solid #333;
		margin-bottom: 5px;
	}

	.leader-row {
		display: grid;
		grid-template-columns: 50px 1fr 100px 60px;
		gap: 10px;
		padding: 8px;
		font-size: 12px;
		border-bottom: 1px solid #1a1a1a;
		transition: all 0.2s ease;
	}

	.leader-row:hover {
		background: #1a1a1a;
		transform: translateX(2px);
	}

	.leader-row.highlight {
		background: #1a1a1a;
		border: 1px solid #ff9500;
		animation: pulse 2s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% {
			border-color: #ff9500;
		}
		50% {
			border-color: #ffb733;
		}
	}

	.rank {
		color: #ff9500;
		font-weight: bold;
	}

	.address {
		color: #fff;
		font-family: monospace;
	}

	.pnl-up {
		color: #00ff00;
		font-weight: bold;
		text-align: right;
	}

	.pnl-down {
		color: #ff0000;
		font-weight: bold;
		text-align: right;
	}

	::-webkit-scrollbar {
		width: 8px;
	}

	::-webkit-scrollbar-track {
		background: #000;
	}

	::-webkit-scrollbar-thumb {
		background: #333;
	}

	::-webkit-scrollbar-thumb:hover {
		background: #ff9500;
	}
</style>
