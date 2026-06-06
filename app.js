let chart = null;
let portfolio = JSON.parse(localStorage.getItem("portfolio")) || [];
let lastCall = 0;
let currency = localStorage.getItem("currency") || "usd";

// RATE LIMIT CONTROL
function canCallAPI() {
    const now = Date.now();
    if (now - lastCall < 1500) return false;
    lastCall = now;
    return true;
}

// SAFE FETCH (IMPORTANT CORE)

async function safeFetch(url) {
    try {
        const res = await fetch(url);

        if (!res) {
            throw new Error("NO_RESPONSE");
        }

        if (res.status === 429) {
            throw new Error("RATE_LIMIT");
        }

        if (!res.ok) {
            throw new Error("HTTP_ERROR");
        }

        return await res.json();

    } catch (err) {

        // ⭐ 关键：区分 network fail
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
        console.error(err);
        return null;
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
            return `${d.getDate()}/${d.getMonth() + 1}`;
        });

        const values = historyData.prices.map(p => p[1]);

        drawChart(labels, values);

    } catch (error) {
        console.error(error);
        showModal("❌ Failed to load data");
    }
}

// DRAW CHART
function drawChart(labels, values) {

    const ctx = document.getElementById("chart").getContext("2d");

    if (chart) chart.destroy();

    chart = new Chart(ctx, {
    type: "line",
    data: {
        labels,
        datasets: [{
            label: `Price (${currency.toUpperCase()})`,
            data: values,
            borderColor: "blue",
            fill: false
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false
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

        portfolio.push({ coin, amount, buyPrice });
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

    const ids = portfolio.map(i => i.coin).join(",");

    try {
        const data = await safeFetch(
            `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=${currency}`
        );

        for (let item of portfolio) {

            const currentPrice = data?.[item.coin]?.[currency];

            if (!currentPrice) continue;

            const valueNow = currentPrice * item.amount;
            const cost = item.buyPrice * item.amount;
            const profit = valueNow - cost;

            const div = document.createElement("div");

            div.innerHTML = `
                <b>${item.coin.toUpperCase()}</b><br>
                Amount: ${item.amount}<br>
                Buy Price: ${item.buyPrice} ${currency.toUpperCase()}<br>
                Current Price: ${currentPrice} ${currency.toUpperCase()}<br><br>

                Value: ${valueNow.toFixed(2)} ${currency.toUpperCase()}<br>
                Profit: <span style="color:${profit >= 0 ? 'lime' : 'red'}">
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

    document.querySelectorAll('.section').forEach(sec => {
        sec.classList.add('hidden');
    });

    document.getElementById(id).classList.remove('hidden');

    resetUI();

    document.getElementById("sidebar").classList.remove("show");
    document.getElementById("overlay").classList.remove("show");
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

    const selector = document.getElementById("currencySelect");

    // set initial value
    selector.value = currency;

    // bind event ONCE
    selector.addEventListener("change", (e) => {
        currency = e.target.value;

        localStorage.setItem("currency", currency);

        updateCurrencyUI();

        showModal("Currency set to " + currency.toUpperCase());
    });

    updateCurrencyUI();
    renderPortfolio();
});

function updateCurrencyUI() {

    const badge = document.getElementById("currencyBadge");
    if (badge) {
        badge.innerText = `Active Currency: ${currency.toUpperCase()}`;
    }

    const selector = document.getElementById("currencySelect");
    if (selector) {
        selector.value = currency;
    }
}
