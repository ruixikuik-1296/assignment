let chart = null;
let indicatorChart = null;
let portfolio = JSON.parse(localStorage.getItem("portfolio")) || [];
let marketLoading = false;
let lastCall = 0;
let currency = localStorage.getItem("currency") || "usd";
let fx = {
    usd: 1,
    myr: 4.7,
    eur: 0.92
};

// RATE LIMIT CONTROL
function canCallAPI() {
    const now = Date.now();
    if (now - lastCall < 1500) return false;
    lastCall = now;
    return true;
}

function isVisible(id) {
    const el = document.getElementById(id);
    return el && !el.classList.contains("hidden");
}

// SAFE FETCH
async function safeFetch(url, retry = 2) {
    try {
        const res = await fetch(url);

        if (res.status === 429) {
            throw new Error("RATE_LIMIT");
        }

        if (!res.ok) throw new Error("HTTP_ERROR");

        return await res.json();

    } catch (err) {

        if (err.message === "RATE_LIMIT" && retry > 0) {
            await new Promise(r => setTimeout(r, 2000));
            return safeFetch(url, retry - 1);
        }

        if (err instanceof TypeError) {
            throw new Error("NETWORK_FAIL");
        }

        throw err;
    }
}

// GET COIN ID
const coinMap = {
    btc: "bitcoin",
    eth: "ethereum",
    sol: "solana",
    doge: "dogecoin",
    bitcoin: "bitcoin",
    ethereum: "ethereum"
};

async function getCoinId(input) {

    // 1. run local map
    if (coinMap[input]) {
        return coinMap[input];
    }

    try {

        // 2. run API search
        const data = await safeFetch(
            `https://api.coingecko.com/api/v3/search?query=${input}`
        );

        if (!data?.coins?.length) return null;

        const q = input.toLowerCase();

        // 3. find match id
        let match = data.coins.find(c => c.id === q);

        // 4. symbol match
        if (!match) {
            match = data.coins.find(c => c.symbol?.toLowerCase() === q);
        }

        // 5. fallback
        if (!match) {
            match = data.coins[0];
        }

        return match?.id || null;

    } catch (err) {
    throw err;
}
}
// GET PRICE + CHART
async function getPrice() {

    if (!canCallAPI()) {
        showModal("⚠️ Please wait before making another request");
        return;
    }

    const input = document.getElementById("coin").value.trim().toLowerCase();

    if (!input) {
        showModal("⚠️ Please enter cryptocurrency name");
        return;
    }

    const coin = await getCoinId(input);

    if (!coin) {
        showModal("❌ Cryptocurrency not found");
        return;
    }

    try {

        const priceData = await safeFetch(
            `https://api.coingecko.com/api/v3/simple/price?ids=${coin}&vs_currencies=${currency}`
        );

        const price = priceData?.[coin]?.[currency];

        if (!price) {
            showModal("❌ Price not available");
            return;
        }

        document.getElementById("result").innerHTML = `
            💰 ${coin.toUpperCase()} Price: ${price} ${currency.toUpperCase()}
        `;

        const historyData = await safeFetch(
            `https://api.coingecko.com/api/v3/coins/${coin}/market_chart?vs_currency=${currency}&days=7`
        );

        const labels = historyData.prices.map(p => {
            const d = new Date(p[0]);
            return `${d.getDate()}/${d.getMonth()+1} ${d.getHours()}:00`;
        });

        const values = historyData.prices.map(p => p[1]);

        drawChart(labels, values);

    } catch (error) {

    if (error.message === "RATE_LIMIT") {
        showModal("⚠️ API rate limit hit, wait a few seconds");
        return;
    }

    if (error.message === "NETWORK_FAIL") {
        showModal("🌐 Request failed (network or API unavailable)");
        return;
    }

    if (error.message === "HTTP_ERROR") {
        showModal("⚠️ Server error");
        return;
    }

    console.error(error);
    showModal("❌ Failed to load data");
}
}

function calcSMA(values, period = 7) {
  return values.map((_, i) => {
    if (i < period - 1) return null;
    const slice = values.slice(i - period + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  });
}

function calcRSI(values, period = 14) {
    let gains = [];
    let losses = [];

    for (let i = 1; i < values.length; i++) {
        const diff = values[i] - values[i - 1];

        gains.push(diff > 0 ? diff : 0);
        losses.push(diff < 0 ? Math.abs(diff) : 0);
    }

    return values.map((_, i) => {
        if (i < period) return null;

        const avgGain =
            gains.slice(i - period, i).reduce((a, b) => a + b, 0) / period;

        const avgLoss =
            losses.slice(i - period, i).reduce((a, b) => a + b, 0) / period;

        const rs = avgGain / (avgLoss || 1);

        return 100 - 100 / (1 + rs);
    });
}

function EMA(values, period) {
    const k = 2 / (period + 1);

    let ema = [values[0]];

    for (let i = 1; i < values.length; i++) {
        ema.push(values[i] * k + ema[i - 1] * (1 - k));
    }

    return ema;
}

function calcMACD(values) {
    const ema12 = EMA(values, 12);
    const ema26 = EMA(values, 26);

    return values.map((_, i) => {
        if (!ema26[i]) return null;
        return ema12[i] - ema26[i];
    });
}

function linearRegression(values) {
  const n = values.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  values.forEach((y, x) => {
    sumX += x;  sumY += y;
    sumXY += x * y;  sumXX += x * x;
  });
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function resetZoom() {
    if (chart) chart.resetZoom();
}

function getCSSVar(name) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

function drawChart(labels, values) {

    const ctx = document.getElementById("chart").getContext("2d");
    if (chart) chart.destroy();

    // CSS variables (clean separation of styling)
    const root = getComputedStyle(document.documentElement);
    const priceColor = root.getPropertyValue("--chart-price-color").trim();
    const smaColor   = root.getPropertyValue("--chart-sma-color").trim();
    const predColor  = root.getPropertyValue("--chart-pred-color").trim();

    // Prediction (linear regression)
    const { slope, intercept } = linearRegression(values);

    const predLabels = ["Day+1", "Day+2", "Day+3"];
    const predValues = Array.from({ length: 3 }, (_, i) =>
        slope * (values.length + i) + intercept
    );

    const allLabels = [...labels, ...predLabels];

    const historicData = [...values, null, null, null];

    const predData = [
        ...new Array(values.length - 1).fill(null),
        values[values.length - 1],
        ...predValues
    ];

    chart = new Chart(ctx, {
        type: "line",
        data: {
            labels: allLabels,
            datasets: [

                // PRICE
                {
                    label: `Price (${currency.toUpperCase()})`,
                    data: historicData,
                    borderColor: priceColor,
                    fill: false
                },

                // SMA
                {
                    label: "7-day SMA",
                    data: calcSMA(values, 7),
                    borderColor: smaColor,
                    borderDash: [4, 2],
                    fill: false,
                    pointRadius: 0
                },

                // PREDICTION
                {
                    label: "Prediction (linear)",
                    data: predData,
                    borderColor: predColor,
                    borderDash: [6, 4],
                    fill: false,
                    pointRadius: 3
                }
            ]
        },

        options: {
            responsive: true,
            maintainAspectRatio: false,

            plugins: {
                legend: { display: true },

                zoom: {
                    zoom: {
                        wheel: { enabled: true },
                        pinch: { enabled: true },
                        mode: "x"
                    },
                    pan: { enabled: true, mode: "x" }
                }
            },

            onClick: (e, elements) => {

                if (!elements.length) return;

                const index = elements[0].index;

                document.getElementById("annotationText").innerText =
                    `Selected Price: ${values[index].toFixed(2)}`;
            }
        }
    });

    // IMPORTANT: draw indicator chart together
    drawIndicatorChart(values);
}

function drawIndicatorChart(values) {

    const ctx = document.getElementById("indicatorChart").getContext("2d");
    if (indicatorChart) indicatorChart.destroy();

    const labels = values.map((_, i) => i);

    indicatorChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: labels,
            datasets: [

                // RSI
                {
                    label: "RSI (14)",
                    data: calcRSI(values),
                    borderColor: "#9b59b6",
                    fill: false,
                    pointRadius: 0
                },

                // MACD
                {
                    label: "MACD",
                    data: calcMACD(values),
                    borderColor: "#ffaa00",
                    fill: false,
                    pointRadius: 0
                }

            ]
        },

        options: {
            responsive: true,
            maintainAspectRatio: false,

            plugins: {
                legend: { display: true }
            },

            scales: {
                y: {
                    beginAtZero: false
                }
            }
        }
    });
}

// ADD ASSET
async function addAsset() {

    const inputCoin = document.getElementById("pCoin").value.trim().toLowerCase();
    const amount = parseFloat(document.getElementById("pAmount").value);
    const buyPrice = parseFloat(document.getElementById("pBuyPrice").value);

    if (!inputCoin) return showModal("⚠️ Please enter coin name");
    if (isNaN(amount) || amount <= 0) return showModal("⚠️ Invalid amount");
    if (isNaN(buyPrice) || buyPrice <= 0) return showModal("⚠️ Invalid buy price");

    try {

        const coin = await getCoinId(inputCoin);

        if (!coin) {
            showModal("❌ Invalid coin name");
            return;
        }

        portfolio.push({ coin, amount, buyPriceUSD: buyPrice  });
        localStorage.setItem("portfolio", JSON.stringify(portfolio));

        renderPortfolio();
        showModal("✅ Asset added successfully");

    } catch (err) {
        console.error(err);
        showModal("❌ Failed to add asset");
    }
}

// RENDER PORTFOLIO (BATCH API)
async function renderPortfolio() {

    const list = document.getElementById("portfolioList");
    list.innerHTML = "";

    if (portfolio.length === 0) {
        list.innerHTML = "<p style='opacity:0.6'>No assets yet.</p>";
        return;
    }

    const ids = [...new Set(
        portfolio
        .map(i => i.coin)
        .filter(Boolean)
        )].join(",");

    try {
        const data = await safeFetch(
            `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=${currency}`
        );

        for (let item of portfolio) {

            const currentPrice = data?.[item.coin]?.[currency];

            if (!currentPrice) continue;

            const fxRate = fx[currency];

            const buyPrice = item.buyPriceUSD * fxRate;

            const valueNow = currentPrice * item.amount;
            const cost = buyPrice * item.amount;
            const profit = valueNow - cost;

            const div = document.createElement("div");

            div.innerHTML = `
                <b>${item.coin.toUpperCase()}</b><br>
                Amount: ${item.amount}<br>
                Buy Price: ${buyPrice.toFixed(2)} ${currency.toUpperCase()}<br>
                Current Price: ${currentPrice} ${currency.toUpperCase()}<br><br>

                Value: ${valueNow.toFixed(2)} ${currency.toUpperCase()}<br>
                Profit: <span class="${profit >= 0 ? 'profit' : 'loss'}">
                    ${profit.toFixed(2)} ${currency.toUpperCase()}
                </span>
            `;

            list.appendChild(div);
        }

    } catch (error) {
        showModal("❌ Failed to load portfolio");
    }
}

// CLEAR PORTFOLIO
function clearPortfolio() {

    portfolio = [];
    localStorage.removeItem("portfolio");

    renderPortfolio();
    showModal("🗑️ Portfolio cleared");
}

function updateLastTime() {
    const now = new Date();

    const time = now.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });

    const el = document.getElementById("lastUpdated");
    if (el) el.innerText = `Last updated: ${time}`;
}

async function loadMarketOverview() {

    const marketBox = document.getElementById("globalMarket");

    if (!marketBox) return;

    const data = await safeFetch(
        "https://api.coingecko.com/api/v3/global"
    );

    const g = data.data;

    marketBox.innerHTML = `
        <div class="stat-card">
            <div class="stat-value">$${g.total_market_cap.usd.toLocaleString()}</div>
            <div class="stat-label">Market Cap</div>
        </div>

        <div class="stat-card">
            <div class="stat-value">$${g.total_volume.usd.toLocaleString()}</div>
            <div class="stat-label">24h Volume</div>
        </div>

        <div class="stat-card">
            <div class="stat-value">${g.market_cap_percentage.btc.toFixed(2)}%</div>
            <div class="stat-label">BTC Dominance</div>
        </div>

        <div class="stat-card">
            <div class="stat-value">${g.active_cryptocurrencies}</div>
            <div class="stat-label">Active Coins</div>
        </div>
    `;

    const btcDom = g.market_cap_percentage.btc;

    const sentimentEl = document.getElementById("marketSentiment");
    if (sentimentEl) {
        sentimentEl.innerText = getMarketSentiment(btcDom);
    }

    updateLastTime();
}

async function loadMarketMovers() {

    const data = await safeFetch(
        "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1"
    );

    const sorted = [...data].sort((a, b) =>
        b.price_change_percentage_24h - a.price_change_percentage_24h
    );

    const topGainers = sorted.slice(0, 3);
    const topLosers = sorted.slice(-3).reverse();

    const container = document.getElementById("marketMovers");
    if (!container) return;

    container.innerHTML = "";

    // Gainers
    container.innerHTML += `<div class="mover-title gain">Top Gainers</div>`;

    topGainers.forEach(c => {
        container.innerHTML += `
            <div class="mover-item">
                <span>${c.symbol.toUpperCase()}</span>
                <span class="gain">
                    +${c.price_change_percentage_24h.toFixed(2)}%
                </span>
            </div>
        `;
    });

    // Losers
    container.innerHTML += `<div class="mover-title loss">Top Losers</div>`;

    topLosers.forEach(c => {
        container.innerHTML += `
            <div class="mover-item">
                <span>${c.symbol.toUpperCase()}</span>
                <span class="loss">
                    ${c.price_change_percentage_24h.toFixed(2)}%
                </span>
            </div>
        `;
    });
}

function getMarketSentiment(btcDominance) {

    if (btcDominance > 60) return "🟢 BTC Dominant Market";
    if (btcDominance < 45) return "🟡 Altcoin Season";
    return "🔵 Neutral Market";
}

async function loadTopCoins() {

    if (marketLoading) return;
    marketLoading = true;

    try {
        const data = await safeFetch(
            "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1"
        );

        const container = document.getElementById("topCoins");
        if (!container) return;

        container.innerHTML = "";

        data.forEach(coin => {

            const change = coin.price_change_percentage_24h;

            const div = document.createElement("div");

            div.className = "coin-card";
            div.innerHTML = `
            <div>
                <b>#${coin.market_cap_rank} ${coin.symbol.toUpperCase()}</b>
                <div style="font-size:12px; opacity:0.7">${coin.name}</div>
            </div>

            <div class="coin-card">
                <div style="text-align:right">
                    <div>$${coin.current_price}</div>

                    <div class="${change >= 0 ? 'gain' : 'loss'}">
                        ${change?.toFixed(2)}%
                    </div>
                </div>
            </div>
            `;

            container.appendChild(div);
        });

    } catch (e) {
        console.warn("Top coins failed:", e);
    }

    marketLoading = false;
}

// UI RESET
function resetUI() {

    document.getElementById("coin").value = "";

    const result = document.getElementById("result");
    if (result) result.innerHTML = "";

    if (chart) {
        chart.destroy();
        chart = null;
    }
}

// SECTION SWITCH
function showSection(id) {

    document.querySelectorAll(".section").forEach(sec => {
        sec.classList.add("hidden");
    });

    document.getElementById(id).classList.remove("hidden");

    resetUI();

    document.getElementById("sidebar").classList.remove("show");
    document.getElementById("overlay").classList.remove("show");

    if (id === "market") {
        loadMarketOverview();
        loadTopCoins();
        loadMarketMovers();
    }

    if (id === "portfolio") {
        renderPortfolio();
    }
}
// SIDEBAR
function toggleSidebar() {

    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("overlay");

    sidebar.classList.toggle("show");
    overlay.classList.toggle("show");
}

// MODAL
function showModal(message) {

    const modal = document.getElementById("modal");
    const modalText = document.getElementById("modalText");

    modalText.innerText = message;

    modal.classList.remove("hidden");

    setTimeout(() => {
        modal.classList.add("hidden");
    }, 2500);
}

// INIT
document.addEventListener("DOMContentLoaded", () => {

    const init = async () => {

        await updateFXRates(); // ⭐ 这里 await

        const searchSelect = document.getElementById("currencySelect");
        const portfolioSelect = document.getElementById("portfolioCurrencySelect");

        if (!searchSelect) return;

        // init UI
        searchSelect.value = currency;
        if (portfolioSelect) portfolioSelect.value = currency;

        function setCurrency(newCurrency) {

            if (currency === newCurrency) return;

            currency = newCurrency;
            localStorage.setItem("currency", currency);

            updateCurrencyUI();

            showModal("Currency → " + currency.toUpperCase());

            const input = document.getElementById("coin")?.value?.trim();
            if (input) getPrice();

            renderPortfolio();
        }

        searchSelect.addEventListener("change", e => setCurrency(e.target.value));

        if (portfolioSelect) {
            portfolioSelect.addEventListener("change", e => setCurrency(e.target.value));
        }

        updateCurrencyUI();
        renderPortfolio();
    };

    init(); 
});

function startAutoUpdate() {

    setInterval(() => {

        const marketVisible = !document.getElementById("market")?.classList.contains("hidden");
        const portfolioVisible = !document.getElementById("portfolio")?.classList.contains("hidden");

        // 🌍 MARKET auto refresh
        if (marketVisible) {
            loadMarketOverview();
            loadTopCoins();
        }

        if (portfolioVisible) {
            renderPortfolio();
        }

    }, 60000); 
}

function updateCurrencyUI() {

    const badge = document.getElementById("currencyBadge");

    if (badge) {
        badge.innerText = `Active Currency: ${currency.toUpperCase()}`;
    }

    const search = document.getElementById("currencySelect");
    const portfolioSelect = document.getElementById("portfolioCurrencySelect");
    if (portfolioSelect) portfolioSelect.value = currency;


    if (search) search.value = currency;
    if (portfolio) portfolio.value = currency;
}

async function updateFXRates() {
    try {
        const res = await fetch(
            "https://api.fxratesapi.com/latest?base=USD&currencies=MYR,EUR"
        );

        if (!res || !res.ok) throw new Error("FX_FETCH_FAILED");

        const data = await res.json();

        console.log("FX API response:", data);

        if (!data?.rates) throw new Error("FX_INVALID_DATA");

        fx.usd = 1;
        fx.myr = data.rates.MYR;
        fx.eur = data.rates.EUR;

        console.log("FX updated:", fx);

    } catch (err) {
        console.error("FX failed, fallback used", err);

        fx.usd = 1;
        fx.myr = 4.7;
        fx.eur = 0.92;
    }
}
