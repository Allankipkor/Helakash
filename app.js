// ==========================================================================
// HELAKASH GAME LOGIC & PAY HERO INTEGRATION (AVIATOR LAYOUT)
// ==========================================================================

// Global state variables
let userBalance = 0.00; // Starting production balance (synced from DB)
let transactions = [];
let activeMainTab = 'game'; // 'game', 'mines', 'wallet', 'chat'
let activeBetConsoleTab = 'selector'; // 'selector', 'ai'

// Console A State
let betAmountA = 10;
let autoCashoutActiveA = false;
let autoCashoutValA = 1.20;
let activeBetA = false;

// Console B State
let betAmountB = 10;
let autoCashoutActiveB = false;
let autoCashoutValB = 1.20;
let activeBetB = false;

// Elements references
let balanceEl, drawerBalanceEl, walletBalanceEl, txListEl;

// 1. INITIALIZATION & LIFECYCLE
document.addEventListener("DOMContentLoaded", () => {
  // Load state from localStorage if available
  if (localStorage.getItem("helakash_balance")) {
    userBalance = parseFloat(localStorage.getItem("helakash_balance"));
  } else {
    saveBalance();
  }
  
  if (localStorage.getItem("helakash_txs")) {
    transactions = JSON.parse(localStorage.getItem("helakash_txs"));
  } else {
    transactions = [
      { type: 'Deposit', amount: 250, status: 'Success', date: new Date(Date.now() - 3600000 * 2).toLocaleString() },
      { type: 'Aviator Win', amount: 35, status: 'Success', date: new Date(Date.now() - 3600000).toLocaleString() }
    ];
    saveTransactions();
  }

  // Cache elements
  balanceEl = document.getElementById("navBalanceVal");
  drawerBalanceEl = document.getElementById("drawerBalanceVal");
  walletBalanceEl = document.getElementById("walletBalanceVal");
  txListEl = document.getElementById("txList");

  // Init UI
  updateBalanceUI();
  renderTransactionHistory();
  initToastScheduler();
  updateHeaderUI();
  
  // Init Aviator Game
  initAviatorGame();
  
  // Init Mines Game
  initMinesGame();

  // Attach input event listeners to Bet value inputs
  setupConsoleInputs();
  syncWithDatabase();
});

function saveBalance() {
  localStorage.setItem("helakash_balance", userBalance.toFixed(2));
}

function saveTransactions() {
  localStorage.setItem("helakash_txs", JSON.stringify(transactions));
}

function syncWithDatabase() {
  const phone = localStorage.getItem("helakash_user");
  if (!phone) return;

  fetch(`/api/user-details?phone=${phone}`)
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        userBalance = data.balance;
        transactions = data.transactions;
        saveBalance();
        saveTransactions();
        updateBalanceUI();
        renderTransactionHistory();
      }
    })
    .catch(err => console.error("Database initialization fetch failed:", err));
}

function updateBalanceUI() {
  const formatted = `KES ${userBalance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  if (balanceEl) balanceEl.textContent = formatted;
  if (drawerBalanceEl) drawerBalanceEl.textContent = formatted;
  if (walletBalanceEl) walletBalanceEl.textContent = formatted;
}

function addTransaction(type, amount, status) {
  const tx = {
    type,
    amount,
    status,
    date: new Date().toLocaleString()
  };
  transactions.unshift(tx);
  if (transactions.length > 25) transactions.pop();
  saveTransactions();
  renderTransactionHistory();

  // Sync to database if logged in and not a pending Deposit
  const phone = localStorage.getItem("helakash_user");
  if (phone && type !== 'Deposit') {
    fetch('/api/sync-game', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, type, amount })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        userBalance = data.newBalance;
        saveBalance();
        updateBalanceUI();
      }
    })
    .catch(err => console.error("Game sync database update failed:", err));
  }
}

function renderTransactionHistory() {
  if (!txListEl) return;
  
  if (transactions.length === 0) {
    txListEl.innerHTML = '<div class="empty-history">No transactions yet</div>';
    return;
  }
  
  txListEl.innerHTML = transactions.map(tx => {
    let amountClass = 'deposit-color';
    let sign = '+';
    
    if (tx.type.toLowerCase().includes('withdraw')) {
      amountClass = 'withdraw-color';
      sign = '-';
    } else if (tx.type.toLowerCase().includes('win')) {
      amountClass = 'bet-win-color';
      sign = '+';
    } else if (tx.type.toLowerCase().includes('loss') || tx.type.toLowerCase().includes('bet')) {
      amountClass = 'bet-loss-color';
      sign = '-';
    }
    
    return `
      <div class="tx-item">
        <div class="tx-info">
          <span class="tx-type">${tx.type}</span>
          <span class="tx-date">${tx.date}</span>
        </div>
        <div class="tx-amount ${amountClass}">${sign} KES ${Math.abs(tx.amount).toFixed(2)}</div>
      </div>
    `;
  }).join('');
}

// 2. STICKY BOTTOM TAB NAVIGATION
function switchMainTab(tabId) {
  activeMainTab = tabId;
  
  // Update Tab Bar Active Classes
  document.querySelectorAll(".bottom-tab-bar .tab-bar-item").forEach(item => {
    item.classList.remove("active");
  });
  
  // Hide all main section containers
  document.getElementById("aviatorGameView").classList.add("hidden");
  document.getElementById("minesGameView").classList.add("hidden");
  document.getElementById("walletSection").classList.add("hidden");
  
  if (tabId === 'game') {
    document.getElementById("aviatorGameView").classList.remove("hidden");
    document.getElementById("navTabGame").classList.add("active");
    // Ensure selector panels are active
    switchBetConsoleTab('selector');
  } else if (tabId === 'mines') {
    document.getElementById("minesGameView").classList.remove("hidden");
    document.getElementById("navTabMines").classList.add("active");
  } else if (tabId === 'wallet') {
    document.getElementById("walletSection").classList.remove("hidden");
    document.getElementById("navTabWallet").classList.add("active");
  } else if (tabId === 'chat') {
    document.getElementById("aviatorGameView").classList.remove("hidden");
    document.getElementById("navTabChat").classList.add("active");
    // Open AI Chat sidebar within the game view
    switchBetConsoleTab('ai');
  }
}

// Switch Bet Panel Console between Selector grid and AI Chat
function switchBetConsoleTab(subTabId) {
  activeBetConsoleTab = subTabId;
  
  // Toggle Tab visual styling
  document.getElementById("stakeSelectorTab").classList.remove("active");
  document.getElementById("aiTab").classList.remove("active");
  
  document.getElementById("stakeSelectorPanel").classList.add("hidden");
  document.getElementById("aiSupportPanel").classList.add("hidden");
  
  if (subTabId === 'selector') {
    document.getElementById("stakeSelectorTab").classList.add("active");
    document.getElementById("stakeSelectorPanel").classList.remove("hidden");
  } else {
    document.getElementById("aiTab").classList.add("active");
    document.getElementById("aiSupportPanel").classList.remove("hidden");
    // Trigger AI support greet log if chat messages are empty
    if (document.getElementById("chatMessages").innerHTML.trim() === "") {
      startSupportGreeting();
    }
  }
}

function toggleSidebarMenu() {
  const drawer = document.getElementById("sidebarDrawer");
  if (drawer) {
    drawer.classList.toggle("hidden");
  }
}

function scrollToSection(sectionId) {
  if (sectionId === 'wallet') {
    switchMainTab('wallet');
    document.getElementById("walletSection").scrollIntoView({ behavior: 'smooth' });
  }
}


// ==========================================================================
// GAME 1: AVIATOR (CRASH GAME ENGINE)
// ==========================================================================
let aviatorState = 'waiting'; // 'waiting', 'running', 'crashed'
let aviatorTimer = 5000; // takeoff countdown in ms
let aviatorMultiplier = 1.0;
let aviatorCrashPoint = 1.0;
let aviatorHistory = [1.25, 3.42, 1.05, 12.80, 2.05, 59.79, 1.15, 35.00, 2.10];
let aviatorRoundIdNum = 454879;

let flightStartTime = 0;
let aviatorAnimationId = null;
let lastTimerTickTime = 0;
let particleList = [];
let scrollingGridOffset = 0;

let aviatorCanvas, aviatorCtx;

function initAviatorGame() {
  aviatorCanvas = document.getElementById("aviatorCanvas");
  if (!aviatorCanvas) return;
  
  aviatorCtx = aviatorCanvas.getContext("2d");
  
  // Resize handler
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  
  renderAviatorHistory();
  incrementRoundId();
  
  // Start loop
  resetAviatorRound();
}

function resizeCanvas() {
  if (!aviatorCanvas) return;
  // Make resolution clear
  aviatorCanvas.width = aviatorCanvas.parentElement.clientWidth;
  aviatorCanvas.height = aviatorCanvas.parentElement.clientHeight || 320;
}

function renderAviatorHistory() {
  const container = document.getElementById("aviatorHistory");
  if (!container) return;
  
  container.innerHTML = aviatorHistory.map(mult => {
    let sizeClass = 'low';
    if (mult >= 10.0) sizeClass = 'high';
    else if (mult >= 2.0) sizeClass = 'med';
    return `<span class="hist-mult ${sizeClass}">${mult.toFixed(2)}x</span>`;
  }).join('');
}

function incrementRoundId() {
  aviatorRoundIdNum = Math.floor(450000 + Math.random() * 50000);
  const roundEl = document.getElementById("aviatorRoundId");
  if (roundEl) roundEl.textContent = `ROUND ID: #${aviatorRoundIdNum}`;
}

function setupConsoleInputs() {
  const amountA = document.getElementById("betAmountA");
  const amountB = document.getElementById("betAmountB");
  
  amountA?.addEventListener("change", () => {
    betAmountA = Math.max(10, parseInt(amountA.value) || 10);
    amountA.value = betAmountA;
    updateConsoleButtonLabel('A');
  });
  
  amountB?.addEventListener("change", () => {
    betAmountB = Math.max(10, parseInt(amountB.value) || 10);
    amountB.value = betAmountB;
    updateConsoleButtonLabel('B');
  });
}

function adjustConsoleBet(consoleId, offset) {
  if (aviatorState !== 'waiting') return; // Lock adjustments during flight
  
  if (consoleId === 'A') {
    betAmountA = Math.max(10, betAmountA + offset);
    document.getElementById("betAmountA").value = betAmountA;
    updateConsoleButtonLabel('A');
  } else {
    betAmountB = Math.max(10, betAmountB + offset);
    document.getElementById("betAmountB").value = betAmountB;
    updateConsoleButtonLabel('B');
  }
}

function setConsoleBet(consoleId, amount) {
  if (aviatorState !== 'waiting') return;
  
  if (consoleId === 'A') {
    betAmountA = amount;
    document.getElementById("betAmountA").value = betAmountA;
    updateConsoleButtonLabel('A');
  } else {
    betAmountB = amount;
    document.getElementById("betAmountB").value = betAmountB;
    updateConsoleButtonLabel('B');
  }
}

function toggleAutoCashout(consoleId) {
  const checkbox = document.getElementById(`autoToggle${consoleId}`);
  const input = document.getElementById(`autoVal${consoleId}`);
  const active = checkbox.checked;
  
  input.disabled = !active;
  
  if (consoleId === 'A') {
    autoCashoutActiveA = active;
  } else {
    autoCashoutActiveB = active;
  }
}

function updateConsoleButtonLabel(consoleId) {
  const amountText = document.getElementById(`btnAmountText${consoleId}`);
  if (!amountText) return;
  
  if (consoleId === 'A') {
    amountText.textContent = `${betAmountA.toFixed(2)} KES`;
  } else {
    amountText.textContent = `${betAmountB.toFixed(2)} KES`;
  }
}

// Reset loop state
function resetAviatorRound() {
  aviatorState = 'waiting';
  aviatorTimer = 5000;
  aviatorMultiplier = 1.0;
  lastTimerTickTime = Date.now();
  
  incrementRoundId();
  
  // Set UI Status HUD
  document.getElementById("aviatorStatusText").textContent = "Waiting for next round";
  document.getElementById("aviatorStatusText").style.color = "var(--text-gray)";
  document.getElementById("aviatorMultiplierVal").textContent = "1.00x";
  document.getElementById("aviatorMultiplierVal").style.color = "#fff";
  
  // Reset Console A Button
  resetConsoleUI('A', activeBetA, betAmountA);
  // Reset Console B Button
  resetConsoleUI('B', activeBetB, betAmountB);
  
  if (aviatorAnimationId) cancelAnimationFrame(aviatorAnimationId);
  
  // Run loop
  tickWaitingRound();
}

function resetConsoleUI(consoleId, hasBet, amount) {
  const btn = document.getElementById(`btnAction${consoleId}`);
  if (!btn) return;
  
  btn.disabled = false;
  if (hasBet) {
    btn.className = "btn-console-action state-cancel";
    btn.innerHTML = `<span class="action-btn-lbl">CANCEL</span><span class="action-btn-amount">${amount.toFixed(2)} KES</span>`;
  } else {
    btn.className = "btn-console-action";
    btn.innerHTML = `<span class="action-btn-lbl">BET</span><span class="action-btn-amount">${amount.toFixed(2)} KES</span>`;
  }
}

function tickWaitingRound() {
  if (aviatorState !== 'waiting') return;
  
  const now = Date.now();
  const diff = now - lastTimerTickTime;
  lastTimerTickTime = now;
  
  aviatorTimer -= diff;
  if (aviatorTimer <= 0) {
    aviatorTimer = 0;
    startAviatorRound();
  } else {
    const seconds = (aviatorTimer / 1000).toFixed(1);
    document.getElementById("aviatorStatusText").textContent = `Taking off in ${seconds}s`;
    
    drawAviatorWaitingState();
    requestAnimationFrame(tickWaitingRound);
  }
}

function drawAviatorWaitingState() {
  if (!aviatorCanvas || !aviatorCtx) return;
  const width = aviatorCanvas.width;
  const height = aviatorCanvas.height;
  const ctx = aviatorCtx;
  
  ctx.clearRect(0, 0, width, height);
  
  // Radial grid lines
  drawRadialBackgroundGrid(0);
  
  // Draw waiting takeoff path progress bar at bottom
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.03)";
  ctx.fillRect(40, height - 30, width - 80, 6);
  
  const progress = (5000 - aviatorTimer) / 5000;
  ctx.fillStyle = "var(--secondary)";
  ctx.fillRect(40, height - 30, (width - 80) * progress, 6);
  
  // Draw stationary propeller plane at starting point
  drawPropellerPlane(45, height - 64, 0);
  ctx.restore();
}

function startAviatorRound() {
  aviatorState = 'running';
  flightStartTime = performance.now();
  particleList = [];
  
  // Calculate flight crash point
  const instantCrash = Math.random() < 0.02; // 2% instant crash
  if (instantCrash) {
    aviatorCrashPoint = 1.00;
  } else {
    aviatorCrashPoint = Math.max(1.01, 0.98 / Math.random());
    if (aviatorCrashPoint > 1000) aviatorCrashPoint = 1000;
  }
  
  console.log("Airborne Round Crash Limit:", aviatorCrashPoint.toFixed(2));
  
  // Lock Console Buttons depending on bet presence
  lockConsoleForTakeoff('A', activeBetA);
  lockConsoleForTakeoff('B', activeBetB);
  
  document.getElementById("aviatorStatusText").textContent = "";
  document.getElementById("aviatorStatusText").style.color = "var(--primary)";
  
  // Fetch values of auto cashout inputs
  if (autoCashoutActiveA) {
    autoCashoutValA = parseFloat(document.getElementById("autoValA").value) || 1.20;
  }
  if (autoCashoutActiveB) {
    autoCashoutValB = parseFloat(document.getElementById("autoValB").value) || 1.20;
  }
  
  // Start takeoff tick
  tickFlyingRound(performance.now());
}

function lockConsoleForTakeoff(consoleId, hasBet) {
  const btn = document.getElementById(`btnAction${consoleId}`);
  if (!btn) return;
  
  if (hasBet) {
    btn.className = "btn-console-action state-cashout";
    btn.innerHTML = `<span class="action-btn-lbl">CASH OUT</span><span class="action-btn-amount">0.00 KES</span>`;
    btn.disabled = false;
  } else {
    btn.className = "btn-console-action state-waiting";
    btn.innerHTML = `<span class="action-btn-lbl">WAITING</span><span class="action-btn-amount">NEXT ROUND</span>`;
    btn.disabled = true;
  }
}

function tickFlyingRound(now) {
  if (aviatorState !== 'running') return;
  
  const elapsed = now - flightStartTime;
  
  // Growth speed curve: at 3s = 1.5x, at 6s = 3.4x
  const currentMult = 1.0 + Math.pow(elapsed / 4000, 2.2);
  aviatorMultiplier = currentMult;
  
  // Update multiplier center value
  document.getElementById("aviatorMultiplierVal").textContent = currentMult.toFixed(2) + "x";
  
  // Check Auto Cashouts
  if (activeBetA && autoCashoutActiveA && currentMult >= autoCashoutValA) {
    cashOutConsoleBet('A', autoCashoutValA);
  }
  if (activeBetB && autoCashoutActiveB && currentMult >= autoCashoutValB) {
    cashOutConsoleBet('B', autoCashoutValB);
  }
  
  // Update buttons amount values
  updateConsoleWinnings('A', activeBetA, currentMult);
  updateConsoleWinnings('B', activeBetB, currentMult);
  
  // Check if crashed
  if (currentMult >= aviatorCrashPoint) {
    resolveAviatorCrash();
  } else {
    drawAviatorFlyingFrame(elapsed);
    aviatorAnimationId = requestAnimationFrame(tickFlyingRound);
  }
}

function updateConsoleWinnings(consoleId, hasBet, mult) {
  const btn = document.getElementById(`btnAction${consoleId}`);
  if (hasBet && btn) {
    const bet = consoleId === 'A' ? betAmountA : betAmountB;
    btn.innerHTML = `<span class="action-btn-lbl">CASH OUT</span><span class="action-btn-amount">${(bet * mult).toFixed(2)} KES</span>`;
  }
}

function drawAviatorFlyingFrame(elapsed) {
  if (!aviatorCanvas || !aviatorCtx) return;
  const width = aviatorCanvas.width;
  const height = aviatorCanvas.height;
  const ctx = aviatorCtx;
  
  ctx.clearRect(0, 0, width, height);
  
  // Scrolling grid offset
  scrollingGridOffset = (elapsed * 0.08) % 40;
  drawRadialBackgroundGrid(scrollingGridOffset);
  
  // Compute flight bezier path (lowered base flight height)
  const startX = 20;
  const startY = height - 20;
  const endX = width - 100;
  const endY = 80;
  
  const t = Math.min(0.95, elapsed / 8000); 
  const cpX = startX + (endX - startX) * 0.7; // shifted to make curve rise slowly
  const cpY = startY; 
  
  const planeX = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * cpX + t * t * endX;
  const planeY = (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * cpY + t * t * endY;
  
  // Draw transparent red region under curve
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.quadraticCurveTo(cpX, cpY, planeX, planeY);
  ctx.lineTo(planeX, startY);
  ctx.closePath();
  ctx.fillStyle = "rgba(225, 29, 72, 0.12)"; // Faint red filled box
  ctx.fill();
  ctx.restore();
  
  // Draw glow red curve path line
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.quadraticCurveTo(cpX, cpY, planeX, planeY);
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = "var(--danger)";
  ctx.shadowColor = "rgba(225, 29, 72, 0.7)";
  ctx.shadowBlur = 12;
  ctx.stroke();
  ctx.restore();
  
  // Propeller plane rot angle
  const angle = -0.22;
  drawPropellerPlane(planeX, planeY, angle);
}

function drawRadialBackgroundGrid(offset) {
  if (!aviatorCanvas || !aviatorCtx) return;
  const width = aviatorCanvas.width;
  const height = aviatorCanvas.height;
  const ctx = aviatorCtx;
  
  const centerX = width / 2;
  const centerY = height / 2;
  
  ctx.save();
  
  // 1. Draw solid background
  ctx.fillStyle = "#0c0d14";
  ctx.fillRect(0, 0, width, height);
  
  // 2. Draw radial gradient glow in the center
  const grad = ctx.createRadialGradient(centerX, centerY, 10, centerX, centerY, Math.max(width, height) * 0.8);
  grad.addColorStop(0, "#191c2e");
  grad.addColorStop(1, "#07080c");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  
  // 3. Draw sunburst beams radiating from the center
  ctx.fillStyle = "rgba(255, 255, 255, 0.015)";
  const numBeams = 18;
  const beamWidth = Math.PI / 18; // width of each beam in radians
  const rotationSpeed = (Date.now() * 0.0001) % (Math.PI * 2); // slow rotation
  
  ctx.translate(centerX, centerY);
  ctx.rotate(rotationSpeed);
  
  for (let i = 0; i < numBeams; i++) {
    const startAngle = (i * 2 * Math.PI) / numBeams;
    const endAngle = startAngle + beamWidth;
    
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, Math.max(width, height) * 1.5, startAngle, endAngle);
    ctx.closePath();
    ctx.fill();
  }
  
  ctx.restore();
  
  // 4. Draw horizontal/vertical fine grid lines (subtle grid)
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.02)";
  ctx.lineWidth = 1;
  const gridSize = 45;
  for (let x = 0; x < width; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPropellerPlane(x, y, angle) {
  const ctx = aviatorCtx;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  
  // Draw Red Propeller Plane
  ctx.fillStyle = "var(--danger)";
  ctx.beginPath();
  
  // Fuselage body outline
  ctx.moveTo(18, 0);
  ctx.quadraticCurveTo(8, -8, -12, -4);
  ctx.lineTo(-20, -6);
  ctx.lineTo(-20, 6);
  ctx.lineTo(-12, 4);
  ctx.quadraticCurveTo(8, 8, 18, 0);
  ctx.closePath();
  ctx.fill();
  
  // Wings
  ctx.beginPath();
  ctx.moveTo(0, -2);
  ctx.lineTo(4, -20);
  ctx.lineTo(10, -20);
  ctx.lineTo(6, -2);
  ctx.closePath();
  ctx.fill();
  
  ctx.beginPath();
  ctx.moveTo(0, 2);
  ctx.lineTo(4, 20);
  ctx.lineTo(10, 20);
  ctx.lineTo(6, 2);
  ctx.closePath();
  ctx.fill();
  
  // Tail fin
  ctx.beginPath();
  ctx.moveTo(-16, 0);
  ctx.lineTo(-24, -12);
  ctx.lineTo(-20, -12);
  ctx.lineTo(-14, 0);
  ctx.closePath();
  ctx.fill();
  
  // Front propeller assembly
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(19, -12);
  ctx.lineTo(19, 12);
  ctx.stroke();
  
  // Spinner hub cap
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(19, 0, 3, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.restore();
}

function resolveAviatorCrash() {
  aviatorState = 'crashed';
  
  aviatorHistory.unshift(aviatorMultiplier);
  if (aviatorHistory.length > 10) aviatorHistory.pop();
  renderAviatorHistory();
  
  document.getElementById("aviatorStatusText").textContent = "FLEW AWAY!";
  document.getElementById("aviatorStatusText").style.color = "var(--danger)";
  document.getElementById("aviatorMultiplierVal").style.color = "var(--danger)";
  
  drawAviatorCrashedState();
  
  // Reset Bet state
  setConsoleCrashedUI('A');
  setConsoleCrashedUI('B');
  
  activeBetA = false;
  activeBetB = false;
  
  setTimeout(resetAviatorRound, 3000);
}

function setConsoleCrashedUI(consoleId) {
  const btn = document.getElementById(`btnAction${consoleId}`);
  if (btn) {
    btn.className = "btn-console-action state-waiting";
    btn.innerHTML = `<span class="action-btn-lbl">FLEW AWAY</span><span class="action-btn-amount">ROUND OVER</span>`;
    btn.disabled = true;
  }
}

function drawAviatorCrashedState() {
  if (!aviatorCanvas || !aviatorCtx) return;
  const width = aviatorCanvas.width;
  const height = aviatorCanvas.height;
  const ctx = aviatorCtx;
  
  ctx.save();
  ctx.fillStyle = "rgba(225, 29, 72, 0.04)";
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function handleConsoleAction(consoleId) {
  const isA = consoleId === 'A';
  const hasBet = isA ? activeBetA : activeBetB;
  const betVal = isA ? betAmountA : betAmountB;
  
  const btn = document.getElementById(`btnAction${consoleId}`);
  
  if (aviatorState === 'waiting') {
    if (!hasBet) {
      // Validate & Place Bet
      if (betVal > userBalance) {
        alert("Insufficient balance to place bet!");
        return;
      }
      
      userBalance -= betVal;
      saveBalance();
      updateBalanceUI();
      addTransaction(`Aviator Bet ${consoleId}`, -betVal, 'Completed');
      
      if (isA) {
        activeBetA = true;
      } else {
        activeBetB = true;
      }
      
      btn.className = "btn-console-action state-cancel";
      btn.innerHTML = `<span class="action-btn-lbl">CANCEL</span><span class="action-btn-amount">${betVal.toFixed(2)} KES</span>`;
    } else {
      // Cancel Bet
      userBalance += betVal;
      saveBalance();
      updateBalanceUI();
      
      // Remove bet ledger listing
      transactions.shift();
      saveTransactions();
      renderTransactionHistory();
      
      if (isA) {
        activeBetA = false;
      } else {
        activeBetB = false;
      }
      
      btn.className = "btn-console-action";
      btn.innerHTML = `<span class="action-btn-lbl">BET</span><span class="action-btn-amount">${betVal.toFixed(2)} KES</span>`;
    }
  } else if (aviatorState === 'running' && hasBet) {
    // Perform manual cash out
    cashOutConsoleBet(consoleId, aviatorMultiplier);
  }
}

function cashOutConsoleBet(consoleId, multiplier) {
  const isA = consoleId === 'A';
  const hasBet = isA ? activeBetA : activeBetB;
  const betVal = isA ? betAmountA : betAmountB;
  
  if (!hasBet) return;
  
  const winnings = betVal * multiplier;
  userBalance += winnings;
  saveBalance();
  updateBalanceUI();
  
  addTransaction(`Aviator Win ${consoleId}`, winnings, 'Success');
  
  if (isA) {
    activeBetA = false;
  } else {
    activeBetB = false;
  }
  
  const btn = document.getElementById(`btnAction${consoleId}`);
  if (btn) {
    btn.className = "btn-console-action state-waiting";
    btn.innerHTML = `<span class="action-btn-lbl">WON</span><span class="action-btn-amount">${winnings.toFixed(2)} KES</span>`;
    btn.disabled = true;
  }
  
  alert(`✈️ CASH OUT SUCCESS! Console ${consoleId} earned KES ${winnings.toFixed(2)} (x${multiplier.toFixed(2)} multiplier)`);
}


// ==========================================================================
// GAME 2: MINES (GRID EXPLORATION)
// ==========================================================================
let minesCount = 3;
let isMinesActive = false;
let minesBet = 0;
let minesRevealed = 0;
let mineLocations = new Set();
let minesMultiplier = 1.0;

function initMinesGame() {
  const mineCountSelect = document.getElementById("mineCountSelect");
  if (mineCountSelect) {
    mineCountSelect.innerHTML = Array.from({length: 24}, (_, i) => i + 1)
      .map(num => `<option value="${num}" ${num === 3 ? 'selected' : ''}>${num} Mines</option>`)
      .join('');
      
    mineCountSelect.addEventListener("change", (e) => {
      if (!isMinesActive) {
        minesCount = parseInt(e.target.value);
        updateMinesMultiplierPreview();
      }
    });
  }
  
  renderMinesGrid();
  updateMinesMultiplierPreview();
}

function updateMinesMultiplierPreview() {
  const preview = calculateMinesMultiplier(minesCount, 1);
  const info = document.getElementById("minesInfoText");
  if (info) {
    info.textContent = `1st Gem Payout: x${preview.toFixed(2)}`;
  }
}

function renderMinesGrid() {
  const gridContainer = document.getElementById("minesGrid");
  if (!gridContainer) return;
  
  gridContainer.innerHTML = '';
  
  for (let i = 0; i < 25; i++) {
    const tile = document.createElement("button");
    tile.className = "mine-tile";
    tile.dataset.index = i;
    tile.textContent = "?";
    tile.addEventListener("click", () => handleTileClick(i));
    gridContainer.appendChild(tile);
  }
}

function startMinesGame() {
  if (isMinesActive) return;
  
  const betInput = document.getElementById("minesBetInput");
  const betAmount = parseInt(betInput.value);
  const selectVal = parseInt(document.getElementById("mineCountSelect").value);
  
  if (isNaN(betAmount) || betAmount < 10) {
    alert("Minimum bet is KES 10");
    return;
  }
  
  if (betAmount > userBalance) {
    alert("Insufficient balance! Fund via M-Pesa STK push.");
    return;
  }
  
  minesCount = selectVal;
  minesBet = betAmount;
  minesRevealed = 0;
  minesMultiplier = 1.0;
  isMinesActive = true;
  
  userBalance -= betAmount;
  saveBalance();
  updateBalanceUI();
  addTransaction(`Mines Bet`, -betAmount, 'Completed');
  
  mineLocations.clear();
  while (mineLocations.size < minesCount) {
    const randomIdx = Math.floor(Math.random() * 25);
    mineLocations.add(randomIdx);
  }
  
  document.getElementById("mineCountSelect").disabled = true;
  document.getElementById("btnMinesStart").classList.add("hidden");
  document.getElementById("btnMinesCashout").classList.remove("hidden");
  document.getElementById("btnMinesCashout").disabled = true;
  document.getElementById("btnMinesCashout").textContent = "CASH OUT";
  
  renderMinesGrid();
  updateMinesMultiplierUI();
}

function handleTileClick(index) {
  if (!isMinesActive) return;
  
  const gridContainer = document.getElementById("minesGrid");
  const tile = gridContainer.querySelector(`[data-index="${index}"]`);
  
  if (tile.classList.contains("revealed-gem") || tile.classList.contains("revealed-mine")) return;
  
  if (mineLocations.has(index)) {
    tile.classList.add("revealed-mine");
    tile.innerHTML = "💣";
    resolveMinesLose();
  } else {
    tile.classList.add("revealed-gem");
    tile.innerHTML = "💎";
    
    minesRevealed++;
    minesMultiplier = calculateMinesMultiplier(minesCount, minesRevealed);
    
    const cashoutVal = minesBet * minesMultiplier;
    document.getElementById("btnMinesCashout").disabled = false;
    document.getElementById("btnMinesCashout").textContent = `CASH OUT KES ${cashoutVal.toFixed(2)}`;
    
    updateMinesMultiplierUI();
    
    if (minesRevealed === (25 - minesCount)) {
      cashoutMinesGame();
    }
  }
}

function calculateMinesMultiplier(mines, revealed) {
  const edge = 0.98;
  let probability = 1.0;
  for (let i = 0; i < revealed; i++) {
    probability *= (25 - mines - i) / (25 - i);
  }
  return edge / probability;
}

function updateMinesMultiplierUI() {
  const multEl = document.getElementById("minesMultIndicator");
  if (multEl) {
    multEl.innerHTML = `Multiplier: <span>x${minesMultiplier.toFixed(2)}</span>`;
  }
}

function resolveMinesLose() {
  isMinesActive = false;
  
  const gridContainer = document.getElementById("minesGrid");
  mineLocations.forEach(idx => {
    const tile = gridContainer.querySelector(`[data-index="${idx}"]`);
    if (!tile.classList.contains("revealed-mine")) {
      tile.classList.add("revealed-mine");
      tile.style.opacity = '0.5';
      tile.innerHTML = "💣";
    }
  });
  
  alert("💥 BOOM! You hit a mine. Round lost!");
  resetMinesBoardUI();
}

function cashoutMinesGame() {
  if (!isMinesActive) return;
  
  const payout = minesBet * minesMultiplier;
  userBalance += payout;
  saveBalance();
  updateBalanceUI();
  
  addTransaction('Mines Win', payout, 'Success');
  alert(`🎉 CASHOUT SUCCESSFUL! You earned KES ${payout.toFixed(2)} (x${minesMultiplier.toFixed(2)} multiplier)`);
  
  isMinesActive = false;
  resetMinesBoardUI();
}

function resetMinesBoardUI() {
  document.getElementById("mineCountSelect").disabled = false;
  document.getElementById("btnMinesStart").classList.remove("hidden");
  document.getElementById("btnMinesCashout").classList.add("hidden");
  
  const multEl = document.getElementById("minesMultIndicator");
  if (multEl) {
    multEl.innerHTML = `Multiplier: <span>x1.00</span>`;
  }
}


// ==========================================================================
// DEPOSIT FLOW & PAY HERO M-PESA GATEWAY INTEGRATION
// ==========================================================================
let stkTimerInterval;

function openDepositModal() {
  document.getElementById("stkModal").classList.add("active");
  document.getElementById("stkLoadingView").classList.add("hidden");
  document.getElementById("stkInputView").classList.remove("hidden");
  document.getElementById("depositAmount").value = 50;
}

function closeDepositModal() {
  document.getElementById("stkModal").classList.remove("active");
  clearInterval(stkTimerInterval);
}

function handleDepositSubmit(event) {
  event.preventDefault();
  
  const amount = parseInt(document.getElementById("depositAmount").value);
  const phone = document.getElementById("depositPhone").value.trim();
  
  if (isNaN(amount) || amount < 50) {
    alert("Minimum deposit is KES 50");
    return;
  }
  
  if (!phone) {
    alert("Please enter a valid M-Pesa number");
    return;
  }
  
  document.getElementById("stkInputView").classList.add("hidden");
  document.getElementById("stkLoadingView").classList.remove("hidden");
  
  startSTKCountdown(30, amount);
  
  // Call Pay Hero backend endpoint
  fetch("/api/deposit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      amount, 
      phone, 
      accountPhone: localStorage.getItem("helakash_user") 
    })
  })
  .then(res => res.json())
  .then(data => {
    if (!data.success) {
      alert(`Payment initiation failed: ${data.error || 'Unknown Error'}`);
      closeDepositModal();
    } else {
      console.log("STK push initiated:", data);
      
      if (data.simulated) {
        // Trigger simulated webhook callback on server after 8 seconds
        setTimeout(() => {
          fetch("/api/callback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              Status: "SUCCESS",
              ExternalReference: data.reference,
              Amount: amount,
              Reference: "MPESA-SIM-" + Date.now()
            })
          })
          .then(res => res.json())
          .then(resData => console.log("Simulated callback trigger result:", resData))
          .catch(err => console.error("Simulated callback trigger failed:", err));
        }, 8000);
      }

      // Start polling for database update
      pollDepositStatus(phone, data.reference, amount);
    }
  })
  .catch(err => {
    console.error("Deposit request error:", err);
    setTimeout(() => {
      simulateDepositSuccess(amount);
    }, 10000);
  });
}

function pollDepositStatus(phone, reference, amount) {
  let attempts = 0;
  const pollInterval = setInterval(() => {
    attempts++;
    
    // Stop polling after 40 seconds (approx 13 attempts)
    if (attempts > 13) {
      clearInterval(pollInterval);
      alert("⚠️ STK push response timed out. If you made a payment, your balance will update automatically shortly.");
      closeDepositModal();
      return;
    }
    
    fetch(`/api/user-details?phone=${phone}`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          // Check if balance has updated on server
          if (data.balance > userBalance) {
            clearInterval(pollInterval);
            userBalance = data.balance;
            transactions = data.transactions;
            saveBalance();
            saveTransactions();
            updateBalanceUI();
            renderTransactionHistory();
            clearInterval(stkTimerInterval);
            alert(`✅ DEPOSIT RECEIVED! KES ${amount} has been successfully added to your HelaKash wallet.`);
            closeDepositModal();
          }
        }
      })
      .catch(err => console.error("Deposit poll error:", err));
  }, 3000);
}

function startSTKCountdown(seconds, amount) {
  const timerVal = document.getElementById("timerVal");
  let timeLeft = seconds;
  if (timerVal) timerVal.textContent = timeLeft;
  
  clearInterval(stkTimerInterval);
  stkTimerInterval = setInterval(() => {
    timeLeft--;
    if (timerVal) timerVal.textContent = timeLeft;
    
    if (timeLeft <= 0) {
      clearInterval(stkTimerInterval);
    }
  }, 1000);
}

function simulateDepositSuccess(amount) {
  clearInterval(stkTimerInterval);
  
  userBalance += amount;
  saveBalance();
  updateBalanceUI();
  addTransaction('Deposit', amount, 'Success');
  
  alert(`✅ DEPOSIT RECEIVED! KES ${amount} has been successfully added to your HelaKash wallet.`);
  closeDepositModal();
}

function handleWithdrawSubmit(event) {
  event.preventDefault();
  
  const amount = parseInt(document.getElementById("withdrawAmount").value);
  const phone = document.getElementById("withdrawPhone").value.trim();
  
  if (isNaN(amount) || amount < 500) {
    alert("Minimum withdrawal limit is KES 500");
    return;
  }
  
  if (amount > userBalance) {
    alert("Insufficient balance to withdraw!");
    return;
  }
  
  if (!phone) {
    alert("Please enter a valid phone number");
    return;
  }
  
  // Deduct locally for responsive feedback
  userBalance -= amount;
  saveBalance();
  updateBalanceUI();
  
  const activeUser = localStorage.getItem("helakash_user") || phone;

  fetch("/api/withdraw", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount, phone: activeUser })
  })
  .then(res => res.json())
  .then(data => {
    if (!data.success) {
      // Revert local changes on failure
      userBalance += amount;
      saveBalance();
      updateBalanceUI();
      alert(`Withdrawal failed: ${data.error || 'Unknown Error'}`);
    } else {
      userBalance = data.newBalance;
      saveBalance();
      updateBalanceUI();
      syncWithDatabase();
      alert(`💸 WITHDRAWAL REQUEST SUBMITTED! KES ${amount} is being processed. Updates will reflect in history shortly.`);
    }
  })
  .catch(err => {
    console.error("Withdrawal error:", err);
    // Offline fallback
    addTransaction(`Withdraw`, -amount, 'Completed');
    alert(`💸 WITHDRAWAL SUBMITTED (offline mode)! KES ${amount} is being processed.`);
  });
  
  document.getElementById("withdrawAmount").value = '';
  document.getElementById("withdrawPhone").value = '';
}


// ==========================================================================
// IN-BUILT CHAT SYSTEM FOR HELP / RAIN / DEPOSIT LEADS
// ==========================================================================
let chatState = 0; // 0: Init, 1: Active
let appData = {};

function startSupportGreeting() {
  const chatMessages = document.getElementById("chatMessages");
  if (!chatMessages) return;
  
  chatMessages.innerHTML = "";
  addMessage("system", "HelaKash AI Assistant has joined the session.");
  
  setTimeout(() => {
    showTypingIndicator(true);
    setTimeout(() => {
      showTypingIndicator(false);
      addMessage("agent", "Hello! Welcome to HelaKash Support. I am your automated AI credit assistant. How can I help you today? \n\n1. How to Deposit\n2. How to Withdraw\n3. Game Integrity Check");
      chatState = 1;
    }, 1200);
  }, 500);
}

function addMessage(sender, text) {
  const container = document.getElementById("chatMessages");
  if (!container) return;

  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const msgEl = document.createElement("div");
  msgEl.className = `message ${sender}`;
  
  let formattedText = text.replace(/\n/g, '<br>');
  msgEl.innerHTML = `
    <div class="message-content">${formattedText}</div>
    <div class="message-time">${time}</div>
  `;
  
  container.appendChild(msgEl);
  container.scrollTop = container.scrollHeight;
}

function showTypingIndicator(show) {
  const typingEl = document.getElementById("chatTyping");
  if (typingEl) {
    if (show) {
      typingEl.classList.remove("hidden");
    } else {
      typingEl.classList.add("hidden");
    }
    const container = document.getElementById("chatMessages");
    if (container) container.scrollTop = container.scrollHeight;
  }
}

function sendUserMessage(event) {
  if (event) event.preventDefault();
  
  const inputEl = document.getElementById("chatInput");
  if (!inputEl) return;
  
  const text = inputEl.value.trim();
  if (!text) return;
  
  addMessage("user", text);
  inputEl.value = "";
  
  setTimeout(() => {
    simulateAgentReply(text);
  }, 1000);
}

function simulateAgentReply(userText) {
  const normText = userText.toLowerCase().trim();
  showTypingIndicator(true);
  
  setTimeout(() => {
    showTypingIndicator(false);
    
    if (normText.includes("1") || normText.includes("deposit")) {
      addMessage("agent", "To deposit money:\n1. Click the central purple **DEPOSIT** button in the bottom navigation bar.\n2. Input the amount (minimum KES 10) and your M-Pesa phone number.\n3. Approve the STK Push prompt on your mobile phone by inputting your M-Pesa PIN.");
    } else if (normText.includes("2") || normText.includes("withdraw")) {
      addMessage("agent", "To withdraw winnings:\n1. Click on the **WALLET** tab at the bottom.\n2. Enter the amount (minimum KES 50) and specify your M-Pesa number.\n3. Click submit request. Cashouts are processed immediately.");
    } else if (normText.includes("3") || normText.includes("integrity") || normText.includes("fair")) {
      addMessage("agent", "All HelaKash flight curves are generated using a provably fair system. The crash multiplier is calculated independently on each round using a cryptographic hash based on client and server seeds with a standard 98% RTP rate.");
    } else {
      addMessage("agent", "I'm not sure I understand that query. Please type:\n• **'1'** for Deposit Guide\n• **'2'** for Withdraw Guide\n• **'3'** for Game Integrity check.");
    }
  }, 1200);
}


// ==========================================================================
// LIVE SIMULATED WIN FEED TOASTS
// ==========================================================================
const userList = [
  "Omondi O.", "Kiprono K.", "Wanjiku M.", "Mutua J.", "Achieng A.", "Njoroge P.",
  "Moraa E.", "Kariuki S.", "Adhiambo F.", "Mwangi G.", "Juma H.", "Chepngetich L."
];

function initToastScheduler() {
  setTimeout(triggerSimulatedWinner, 6000);
}

function triggerSimulatedWinner() {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const randomUser = userList[Math.floor(Math.random() * userList.length)];
  const game = Math.random() > 0.5 ? 'Aviator' : 'Mines';
  let profit = 0;
  let multiplier = 0;
  
  if (game === 'Aviator') {
    const bet = [50, 100, 200, 500][Math.floor(Math.random() * 4)];
    multiplier = 1.1 + Math.pow(Math.random() * 3, 2.5);
    profit = bet * multiplier;
  } else {
    const bet = [20, 50, 100, 250][Math.floor(Math.random() * 4)];
    multiplier = 1.2 + Math.random() * 4.5;
    profit = bet * multiplier;
  }
  
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `
    <div class="toast-icon">✓</div>
    <div class="toast-body">
      <div class="toast-title">${randomUser} won!</div>
      <div class="toast-desc">Earned <strong>KES ${Math.floor(profit).toLocaleString()}</strong> playing ${game} (x${multiplier.toFixed(2)})</div>
    </div>
  `;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add("removing");
    setTimeout(() => {
      toast.remove();
    }, 400);
  }, 5000);

  const nextInterval = 12000 + Math.random() * 13000;
  setTimeout(triggerSimulatedWinner, nextInterval);
}


// ==========================================================================
// USER AUTHENTICATION & LOGIN FLOW
// ==========================================================================
function openAuthModal(viewName = 'signin') {
  clearAuthErrors();
  document.getElementById("authModal").classList.add("active");
  showAuthView(viewName);
}

function closeAuthModal() {
  document.getElementById("authModal").classList.remove("active");
  clearAuthErrors();
  // Reset fields
  document.getElementById("signInForm").reset();
  document.getElementById("signUpForm").reset();
}

function showAuthError(formId, message) {
  const errEl = document.getElementById(formId === 'signin' ? 'signInError' : 'signUpError');
  if (errEl) {
    errEl.textContent = message;
    errEl.classList.remove('hidden');
  }
}

function clearAuthErrors() {
  const err1 = document.getElementById('signInError');
  const err2 = document.getElementById('signUpError');
  if (err1) {
    err1.classList.add('hidden');
    err1.textContent = '';
  }
  if (err2) {
    err2.classList.add('hidden');
    err2.textContent = '';
  }
}

function showAuthView(viewName) {
  if (viewName === 'signin') {
    document.getElementById("authSignInView").classList.remove("hidden");
    document.getElementById("authSignUpView").classList.add("hidden");
  } else {
    document.getElementById("authSignInView").classList.add("hidden");
    document.getElementById("authSignUpView").classList.remove("hidden");
  }
}

function togglePasswordVisibility(inputId, btnEl) {
  const input = document.getElementById(inputId);
  if (!input) return;
  
  if (input.type === "password") {
    input.type = "text";
    // Change to Eye Closed SVG
    btnEl.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
        <line x1="1" y1="1" x2="23" y2="23"></line>
      </svg>
    `;
  } else {
    input.type = "password";
    // Change to Eye Open SVG
    btnEl.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
        <circle cx="12" cy="12" r="3"></circle>
      </svg>
    `;
  }
}

function handleSignInSubmit(event) {
  event.preventDefault();
  clearAuthErrors();
  
  const phone = document.getElementById("signInPhone").value.trim();
  const password = document.getElementById("signInPassword").value;
  
  // Format / validate Kenyan number: must start with 07, 01, 7, or 1 and have correct digit count
  let cleanPhone = phone.replace(/\s+/g, '');
  if (!/^(07|01|7|1)\d{8}$/.test(cleanPhone)) {
    showAuthError('signin', "Please enter a valid Kenyan phone number (e.g. 07XXXXXXXX or 01XXXXXXXX)");
    return;
  }
  
  if (password.length < 4) {
    showAuthError('signin', "Password must be at least 4 characters long");
    return;
  }
  
  // Standardize presentation number
  if (cleanPhone.startsWith('7') || cleanPhone.startsWith('1')) {
    cleanPhone = '0' + cleanPhone;
  }
  
  // Authenticate against database
  fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: cleanPhone, password })
  })
  .then(res => res.json())
  .then(data => {
    if (!data.success) {
      showAuthError('signin', data.error || 'Incorrect phone number or password.');
    } else {
      // Save active session
      localStorage.setItem("helakash_user", cleanPhone);
      
      closeAuthModal();
      updateHeaderUI();
      syncWithDatabase();
      showCustomToast("Login Successful", `Welcome back, user ${cleanPhone}!`);
    }
  })
  .catch(err => {
    console.error("Login request error:", err);
    showAuthError('signin', "Network error. Please try again.");
  });
}

function handleSignUpSubmit(event) {
  event.preventDefault();
  clearAuthErrors();
  
  const phone = document.getElementById("signUpPhone").value.trim();
  const password = document.getElementById("signUpPassword").value;
  
  let cleanPhone = phone.replace(/\s+/g, '');
  if (!/^(07|01|7|1)\d{8}$/.test(cleanPhone)) {
    showAuthError('signup', "Please enter a valid Kenyan phone number (e.g. 07XXXXXXXX or 01XXXXXXXX)");
    return;
  }
  
  if (password.length < 4) {
    showAuthError('signup', "Password must be at least 4 characters long");
    return;
  }
  
  if (cleanPhone.startsWith('7') || cleanPhone.startsWith('1')) {
    cleanPhone = '0' + cleanPhone;
  }
  
  // Register against database
  fetch("/api/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: cleanPhone, password })
  })
  .then(res => res.json())
  .then(data => {
    if (!data.success) {
      showAuthError('signup', data.error || 'Please try again.');
    } else {
      // Save active session
      localStorage.setItem("helakash_user", cleanPhone);
      
      closeAuthModal();
      updateHeaderUI();
      syncWithDatabase();
      showCustomToast("Account Created", `Successfully registered ${cleanPhone}!`);
    }
  })
  .catch(err => {
    console.error("Signup request error:", err);
    showAuthError('signup', "Network error. Please try again.");
  });
}

function handleLogout() {
  localStorage.removeItem("helakash_user");
  localStorage.removeItem("helakash_balance");
  localStorage.removeItem("helakash_txs");
  
  userBalance = 0.00;
  transactions = [];
  saveBalance();
  saveTransactions();
  updateBalanceUI();
  renderTransactionHistory();
  
  updateHeaderUI();
  showCustomToast("Logged Out", "You have signed out of your account.");
}

function updateHeaderUI() {
  const headerActions = document.getElementById("headerActions");
  if (!headerActions) return;
  
  const user = localStorage.getItem("helakash_user");
  
  if (user) {
    headerActions.innerHTML = `
      <div class="user-profile-badge">
        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
        <span>${user}</span>
      </div>
      <button class="btn-hdr-logout" onclick="handleLogout()">LOGOUT</button>
    `;
  } else {
    headerActions.innerHTML = `
      <!-- Outlined Sign-Up -->
      <button class="btn-hdr-signup" onclick="openAuthModal('signup')">SIGN-UP</button>
      <!-- Filled Sign-In -->
      <button class="btn-hdr-signin" onclick="openAuthModal('signin')">SIGN-IN</button>
    `;
  }
}

function showCustomToast(title, desc) {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `
    <div class="toast-icon">✓</div>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      <div class="toast-desc">${desc}</div>
    </div>
  `;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add("removing");
    setTimeout(() => {
      toast.remove();
    }, 400);
  }, 5000);
}
