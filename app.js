// ==========================================================================
// HELAKASH GAME LOGIC & PAY HERO INTEGRATION (AVIATOR LAYOUT)
// ==========================================================================

// Global state variables
let userBalance = 0.00; // Starting production balance (synced from DB)
let transactions = [];
let activeMainTab = 'game'; // 'game', 'mines', 'wallet', 'chat'
let activeBetConsoleTab = 'selector'; // 'selector', 'ai'

// Dynamic settings limits (synced from DB)
let minDepositLimit = 300;
let minWithdrawalLimit = 500;
let minStakeLimit = 400;

// Console A State
let betAmountA = 400;
let autoCashoutActiveA = false;
let autoCashoutValA = 1.20;
let activeBetA = false;

// Console B State
let betAmountB = 400;
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
      { type: 'Deposit', amount: 300, status: 'Success', date: new Date(Date.now() - 3600000 * 2).toLocaleString() },
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
  loadSystemSettings();
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

  fetch(`/api/user-details?phone=${encodeURIComponent(phone)}&_t=${Date.now()}`)
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        const bal = typeof data.balance === 'number' ? data.balance : (data.user && typeof data.user.balance === 'number' ? data.user.balance : null);
        if (bal !== null && !isNaN(bal)) {
          userBalance = bal;
          saveBalance();
          updateBalanceUI();
        }
        if (data.transactions && Array.isArray(data.transactions)) {
          transactions = data.transactions;
          saveTransactions();
          renderTransactionHistory();
        }
      }
    })
    .catch(err => console.warn("Database sync failed:", err.message));
}

function updateBalanceUI() {
  const formatted = `KES ${userBalance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  if (!balanceEl) balanceEl = document.getElementById("navBalanceVal");
  if (balanceEl) balanceEl.textContent = formatted;
  if (!drawerBalanceEl) drawerBalanceEl = document.getElementById("drawerBalanceVal");
  if (drawerBalanceEl) drawerBalanceEl.textContent = formatted;
  if (!walletBalanceEl) walletBalanceEl = document.getElementById("walletBalanceVal");
  if (walletBalanceEl) walletBalanceEl.textContent = formatted;
}

function addTransaction(type, amount, status, multiplier = null, betAmount = null) {
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

  // Sync to database if logged in
  const phone = localStorage.getItem("helakash_user");
  if (phone) {
    const isWin = type && type.toLowerCase().includes('win');
    fetch('/api/sync-game', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        phone, 
        type, 
        amount, 
        multiplier, 
        betAmount,
        cashoutMultiplier: multiplier,
        winAmount: isWin ? amount : undefined
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        const verifiedBal = (typeof data.newBalance === 'number') ? data.newBalance : ((typeof data.balance === 'number') ? data.balance : null);
        if (verifiedBal !== null && !isNaN(verifiedBal)) {
          userBalance = verifiedBal;
          saveBalance();
          updateBalanceUI();
        }
      }
    })
    .catch(err => console.warn("Game sync database update failed:", err.message));
  }
}

// Format user transactions date for display in local real-time
function formatUserTxDate(dateVal) {
  if (!dateVal) return '';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return String(dateVal);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
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
          <span class="tx-date">${formatUserTxDate(tx.date)}</span>
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
let aviatorTimer = 7500; // takeoff countdown in ms
let aviatorMultiplier = 1.0;
let aviatorCrashPoint = 1.0;
let aviatorEventSource = null;
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
    betAmountA = Math.max(minStakeLimit, parseInt(amountA.value) || minStakeLimit);
    amountA.value = betAmountA;
    updateConsoleButtonLabel('A');
  });
  
  amountB?.addEventListener("change", () => {
    betAmountB = Math.max(minStakeLimit, parseInt(amountB.value) || minStakeLimit);
    amountB.value = betAmountB;
    updateConsoleButtonLabel('B');
  });
}

function adjustConsoleBet(consoleId, offset) {
  if (aviatorState !== 'waiting') return; // Lock adjustments during flight
  
  if (consoleId === 'A') {
    betAmountA = Math.max(minStakeLimit, betAmountA + offset);
    document.getElementById("betAmountA").value = betAmountA;
    updateConsoleButtonLabel('A');
  } else {
    betAmountB = Math.max(minStakeLimit, betAmountB + offset);
    document.getElementById("betAmountB").value = betAmountB;
    updateConsoleButtonLabel('B');
  }
}

function setConsoleBet(consoleId, amount) {
  if (aviatorState !== 'waiting') return;
  
  const targetAmount = Math.max(minStakeLimit, amount);
  if (consoleId === 'A') {
    betAmountA = targetAmount;
    document.getElementById("betAmountA").value = betAmountA;
    updateConsoleButtonLabel('A');
  } else {
    betAmountB = targetAmount;
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
  aviatorTimer = 7500;
  aviatorMultiplier = 1.0;
  lastTimerTickTime = Date.now();
  
  incrementRoundId();
  
  // Set UI Status HUD
  document.getElementById("aviatorStatusText").textContent = "Waiting for next round";
  document.getElementById("aviatorStatusText").style.color = "var(--text-gray)";
  document.getElementById("aviatorMultiplierVal").textContent = "1.00";
  document.getElementById("aviatorMultiplierVal").style.color = "#fff";
  
  // Reset Console A Button
  resetConsoleUI('A', activeBetA, betAmountA);
  // Reset Console B Button
  resetConsoleUI('B', activeBetB, betAmountB);
  
  if (aviatorAnimationId) cancelAnimationFrame(aviatorAnimationId);
  
  // Close any existing event source
  if (aviatorEventSource) {
    try {
      aviatorEventSource.close();
    } catch(err) {
      console.error(err);
    }
  }

  // Get or create guest session ID
  let guestId = localStorage.getItem("helakash_guest_id");
  if (!guestId) {
    guestId = `guest_${Math.random().toString(36).substring(2, 9)}`;
    localStorage.setItem("helakash_guest_id", guestId);
  }
  const phone = localStorage.getItem("helakash_user") || guestId;

  // Connect to the secure backend stream
  aviatorEventSource = new EventSource(`/api/aviator-stream?phone=${encodeURIComponent(phone)}`);

  aviatorEventSource.addEventListener('waiting', (e) => {
    const data = JSON.parse(e.data);
    aviatorTimer = data.remaining;
    const seconds = (aviatorTimer / 1000).toFixed(1);
    document.getElementById("aviatorStatusText").textContent = `Taking off in ${seconds}s`;
    drawAviatorWaitingState();
  });

  aviatorEventSource.addEventListener('tick', (e) => {
    const data = JSON.parse(e.data);
    
    if (aviatorState !== 'running') {
      aviatorState = 'running';
      flightStartTime = Date.now() - (data.elapsed || 0);
      particleList = [];
      
      lockConsoleForTakeoff('A', activeBetA);
      lockConsoleForTakeoff('B', activeBetB);
      
      document.getElementById("aviatorStatusText").textContent = "";
      document.getElementById("aviatorStatusText").style.color = "var(--primary)";
      
      if (autoCashoutActiveA) {
        autoCashoutValA = parseFloat(document.getElementById("autoValA").value) || 1.20;
      }
      if (autoCashoutActiveB) {
        autoCashoutValB = parseFloat(document.getElementById("autoValB").value) || 1.20;
      }

      tickFlyingRound();
    }
  });

  aviatorEventSource.addEventListener('crashed', (e) => {
    const data = JSON.parse(e.data);
    aviatorMultiplier = data.multiplier;
    
    if (aviatorEventSource) {
      aviatorEventSource.close();
      aviatorEventSource = null;
    }

    resolveAviatorCrash();
  });

  aviatorEventSource.onerror = (err) => {
    console.error("Aviator stream error:", err);
  };
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
  
  const progress = (7500 - aviatorTimer) / 7500;
  ctx.fillStyle = "var(--secondary)";
  ctx.fillRect(40, height - 30, (width - 80) * progress, 6);
  
  // Draw stationary propeller plane at starting point
  drawPropellerPlane(45, height - 64, 0);
  ctx.restore();
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

function tickFlyingRound() {
  if (aviatorState !== 'running') return;
  
  const elapsed = Date.now() - flightStartTime;
  
  // Growth speed curve: tuned authentic Aviator pace (divisor: 5500ms, exponent: 1.88)
  const currentMult = 1.0 + Math.pow(elapsed / 5500, 1.88);
  aviatorMultiplier = currentMult;
  
  // Update multiplier center value
  document.getElementById("aviatorMultiplierVal").textContent = currentMult.toFixed(2);
  
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
  
  drawAviatorFlyingFrame(elapsed);
  aviatorAnimationId = requestAnimationFrame(tickFlyingRound);
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
  
  const winnings = parseFloat((betVal * multiplier).toFixed(2));
  userBalance += winnings;
  saveBalance();
  updateBalanceUI();
  
  addTransaction(`Aviator Win ${consoleId}`, winnings, 'Success', multiplier, betVal);
  
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
  
  showCashoutToast(multiplier, winnings, false);
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
  
  if (isNaN(betAmount) || betAmount < minStakeLimit) {
    alert(`Minimum bet is KES ${minStakeLimit}`);
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
  
  const payout = parseFloat((minesBet * minesMultiplier).toFixed(2));
  userBalance += payout;
  saveBalance();
  updateBalanceUI();
  
  addTransaction('Mines Win', payout, 'Success', minesMultiplier, minesBet);
  showCashoutToast(minesMultiplier, payout, true);
  
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
// DEPOSIT FLOW & M-PESA GATEWAY INTEGRATION (PAYHERO / TINYPESA)
// ==========================================================================
let stkTimerInterval;

function openDepositModal() {
  document.getElementById("stkModal").classList.add("active");
  document.getElementById("stkInputView").classList.remove("hidden");
  document.getElementById("stkLoadingView").classList.add("hidden");
  document.getElementById("depositAmount").value = minDepositLimit || 300;
  
  const savedPhone = localStorage.getItem("helakash_user");
  if (savedPhone) {
    const cleanPhone = savedPhone.replace(/\D/g, '');
    const phoneInput = document.getElementById("depositPhone");
    if (phoneInput && !phoneInput.value) {
      if (cleanPhone.startsWith('254') && cleanPhone.length === 12) {
        phoneInput.value = cleanPhone.slice(3);
      } else if (cleanPhone.startsWith('0') && cleanPhone.length === 10) {
        phoneInput.value = cleanPhone.slice(1);
      } else {
        phoneInput.value = cleanPhone;
      }
    }
  }
}

function closeDepositModal() {
  document.getElementById("stkModal").classList.remove("active");
  clearInterval(stkTimerInterval);
}

function handleDepositSubmit(event) {
  event.preventDefault();
  
  const amount = parseInt(document.getElementById("depositAmount").value);
  const phone = document.getElementById("depositPhone").value.trim();
  
  if (isNaN(amount) || amount < minDepositLimit) {
    alert(`Minimum deposit is KES ${minDepositLimit}`);
    return;
  }
  
  const cleanPhone = phone.replace(/\D/g, '');
  const isValidPhone = /^(?:254[71]|0[71]|[71])\d{8}$/.test(cleanPhone);
  if (!phone || !isValidPhone) {
    alert("Please enter a valid M-Pesa number (e.g. 07XXXXXXXX or 7XXXXXXXX)");
    return;
  }
  
  document.getElementById("stkInputView").classList.add("hidden");
  document.getElementById("stkLoadingView").classList.remove("hidden");
  
  startSTKCountdown(30, amount);
  
  const accountUser = localStorage.getItem("helakash_user") || phone;

  // Call Pay Hero backend endpoint
  fetch("/api/deposit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      amount, 
      phone, 
      accountPhone: accountUser 
    })
  })
  .then(res => res.json())
  .then(data => {
    if (!data.success) {
      alert(`Payment initiation failed: ${data.error || 'Unknown Error'}`);
      closeDepositModal();
    } else {
      console.log("Deposit response:", data);
      
      if (data.simulated) {
        // In simulated mode, DB is already credited immediately!
        clearInterval(stkTimerInterval);
        const newBal = (typeof data.newBalance === 'number') ? data.newBalance : ((typeof data.balance === 'number') ? data.balance : userBalance + amount);
        userBalance = newBal;
        saveBalance();
        updateBalanceUI();
        
        // Add transaction to local history
        const tx = {
          type: 'Deposit',
          amount: amount,
          status: 'Success',
          date: new Date().toLocaleString()
        };
        transactions.unshift(tx);
        if (transactions.length > 25) transactions.pop();
        saveTransactions();
        renderTransactionHistory();
        
        alert(`✅ DEPOSIT RECEIVED! KES ${amount} has been successfully added to your wallet.`);
        closeDepositModal();
        return;
      }

      // In live mode: start polling for M-Pesa STK push confirmation
      pollDepositStatus(phone, data.reference, amount);
    }
  })
  .catch(err => {
    console.error("Deposit request error:", err);
    alert("⚠️ Connection error while initiating deposit. Please try again.");
    closeDepositModal();
  });
}

function pollDepositStatus(phone, reference, amount) {
  let attempts = 0;
  const targetPhone = localStorage.getItem("helakash_user") || phone;
  const initialBalance = userBalance;
  
  const pollInterval = setInterval(() => {
    attempts++;
    
    // Stop polling after 60 seconds (24 attempts)
    if (attempts > 24) {
      clearInterval(pollInterval);
      syncWithDatabase();
      alert("⚠️ STK push timeout. If you approved the payment on your phone, your wallet balance will reflect automatically shortly.");
      closeDepositModal();
      return;
    }
    
    fetch(`/api/user-details?phone=${encodeURIComponent(targetPhone)}&_t=${Date.now()}`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          const bal = typeof data.balance === 'number' ? data.balance : (data.user && typeof data.user.balance === 'number' ? data.user.balance : null);
          
          // Check ONLY if this specific reference was marked Success OR if server balance increased
          const txFound = data.transactions && data.transactions.some(t => 
            t.reference === reference && t.status && t.status.toLowerCase() === 'success'
          );
          
          if (txFound || (bal !== null && bal > initialBalance)) {
            clearInterval(pollInterval);
            clearInterval(stkTimerInterval);
            if (bal !== null && !isNaN(bal)) userBalance = bal;
            if (data.transactions) transactions = data.transactions;
            saveBalance();
            saveTransactions();
            updateBalanceUI();
            renderTransactionHistory();
            showToast(`✅ Deposit Received! KES ${amount} added to your wallet.`, 'success', 5000);
            alert(`✅ DEPOSIT RECEIVED! KES ${amount} has been successfully added to your wallet.`);
            closeDepositModal();
          }
        }
      })
      .catch(err => console.error("Deposit poll error:", err));
  }, 2500);
}

// Automatic background balance sync every 6 seconds and on window focus
setInterval(() => {
  if (localStorage.getItem("helakash_user")) {
    syncWithDatabase();
  }
}, 6000);

window.addEventListener("focus", () => {
  if (localStorage.getItem("helakash_user")) {
    syncWithDatabase();
  }
});

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
  
  if (isNaN(amount) || amount < minWithdrawalLimit) {
    alert(`Minimum withdrawal limit is KES ${minWithdrawalLimit}`);
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
      showWithdrawSuccessModal(amount);
    }
  })
  .catch(err => {
    console.error("Withdrawal error:", err);
    // Offline fallback
    addTransaction(`Withdraw`, -amount, 'Completed');
    showWithdrawSuccessModal(amount);
  });
  
  document.getElementById("withdrawAmount").value = '';
  document.getElementById("withdrawPhone").value = '';
}

function showWithdrawSuccessModal(amount) {
  const modalAmount = document.getElementById("withdrawSuccessAmount");
  if (modalAmount) {
    modalAmount.textContent = `KES ${parseFloat(amount).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  }
  const modal = document.getElementById("withdrawSuccessModal");
  if (modal) {
    modal.classList.add("active");
  }
}

function closeWithdrawSuccessModal() {
  const modal = document.getElementById("withdrawSuccessModal");
  if (modal) {
    modal.classList.remove("active");
  }
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
      addMessage("agent", "To deposit money:\n1. Click the central purple **DEPOSIT** button in the bottom navigation bar.\n2. Input the amount (minimum KES 300) and your M-Pesa phone number.\n3. Approve the STK Push prompt on your mobile phone by inputting your M-Pesa PIN.");
    } else if (normText.includes("2") || normText.includes("withdraw")) {
      addMessage("agent", "To withdraw winnings:\n1. Click on the **WALLET** tab at the bottom.\n2. Enter the amount (minimum KES 500) and specify your M-Pesa number.\n3. Click submit request. Cashouts are processed immediately.");
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
    const bet = [400, 500, 1000, 2000][Math.floor(Math.random() * 4)];
    multiplier = 1.1 + Math.pow(Math.random() * 3, 2.5);
    profit = bet * multiplier;
  } else {
    const bet = [400, 500, 1000, 2000][Math.floor(Math.random() * 4)];
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
  fetch("/api/auth?action=login", {
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
  fetch("/api/auth?action=signup", {
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
  updateDrawerUserInfo();
  showCustomToast("Logged Out", "You have signed out of your account.");
}

function updateHeaderUI() {
  const headerActions = document.getElementById("headerActions");
  if (!headerActions) return;
  
  const user = localStorage.getItem("helakash_user");
  const formatted = `KES ${userBalance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  
  if (user) {
    headerActions.innerHTML = `
      <div class="nav-wallet-badge" onclick="switchMainTab('wallet')" title="View Wallet Balance">
        <div class="badge-icon">
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none">
            <rect x="2" y="5" width="20" height="14" rx="2"></rect>
            <line x1="2" y1="10" x2="22" y2="10"></line>
          </svg>
        </div>
        <span id="navBalanceVal" class="badge-amount">${formatted}</span>
      </div>
      <button class="btn-hdr-logout" onclick="handleLogout()">LOGOUT</button>
    `;
    balanceEl = document.getElementById("navBalanceVal");
  } else {
    headerActions.innerHTML = `
      <!-- Outlined Sign-Up -->
      <button class="btn-hdr-signup" onclick="openAuthModal('signup')">SIGN-UP</button>
      <!-- Filled Sign-In -->
      <button class="btn-hdr-signin" onclick="openAuthModal('signin')">SIGN-IN</button>
    `;
    balanceEl = null;
  }
  updateDrawerUserInfo();
}

function updateDrawerUserInfo() {
  const user = localStorage.getItem("helakash_user");
  const drawerUserCard = document.getElementById("drawerUserCard");
  const drawerUserPhone = document.getElementById("drawerUserPhone");
  const walletAccountPhone = document.getElementById("walletAccountPhone");
  const withdrawPhone = document.getElementById("withdrawPhone");
  const depositPhone = document.getElementById("depositPhone");

  if (user) {
    if (drawerUserCard) drawerUserCard.style.display = "flex";
    if (drawerUserPhone) drawerUserPhone.textContent = user;
    if (walletAccountPhone) {
      walletAccountPhone.style.display = "inline-block";
      walletAccountPhone.textContent = `📱 ${user}`;
    }
    if (withdrawPhone && !withdrawPhone.value) {
      withdrawPhone.value = user.startsWith("254") ? user.slice(3) : (user.startsWith("0") ? user.slice(1) : user);
    }
    if (depositPhone && !depositPhone.value) {
      depositPhone.value = user.startsWith("254") ? user.slice(3) : (user.startsWith("0") ? user.slice(1) : user);
    }
  } else {
    if (drawerUserCard) drawerUserCard.style.display = "none";
    if (walletAccountPhone) walletAccountPhone.style.display = "none";
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

function showToast(message, type = 'success', duration = 4000) {
  const container = document.getElementById("toastPopupContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast-notification ${type}`;
  
  // Set animations with custom duration delay
  toast.style.animation = `toast-slide-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards, toast-fade-out 0.4s cubic-bezier(0.7, 0, 0.84, 0) forwards`;
  toast.style.animationDelay = `0s, ${duration - 400}ms`;

  let icon = "💰";
  if (type === 'danger') icon = "💥";
  else if (type === 'warning') icon = "⚠️";
  else if (type === 'info') icon = "ℹ️";
  else if (type === 'success') {
    icon = message.includes("Console") ? "✈️" : "🎉";
  }

  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-content">${message}</div>
    <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
  `;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    if (toast.parentNode) {
      toast.remove();
    }
  }, duration);
}

function showCashoutToast(multiplier, winnings, isMines = false) {
  const container = document.getElementById("toastPopupContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = "toast-notification success-toast";
  
  const duration = 5000;
  toast.style.animation = `toast-slide-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards, toast-fade-out 0.4s cubic-bezier(0.7, 0, 0.84, 0) forwards`;
  toast.style.animationDelay = `0s, ${duration - 400}ms`;

  const gameName = isMines ? "Mines" : "Aviator";
  const icon = isMines ? "🎉" : "✈️";

  toast.innerHTML = `
    <div class="toast-icon" style="background: rgba(16, 185, 129, 0.2); color: #10b981; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px;">${icon}</div>
    <div class="toast-body" style="display: flex; flex-direction: column; gap: 2px;">
      <div class="toast-title" style="color: #10b981; font-weight: 800; font-size: 13px; letter-spacing: 0.5px;">YOU CASHED OUT!</div>
      <div class="toast-desc" style="font-size: 11px; color: rgba(255, 255, 255, 0.7);">Earned <strong style="color: #10b981;">KES ${winnings.toFixed(2)}</strong> playing ${gameName} (x${multiplier.toFixed(2)})</div>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()" style="margin-left: auto; background: transparent; border: none; color: rgba(255,255,255,0.4); font-size: 20px; cursor: pointer; line-height: 1; outline: none;">&times;</button>
  `;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    if (toast.parentNode) {
      toast.remove();
    }
  }, duration);
}



// ==========================================================================
// SECRET ADMIN CONTROL CENTER
// ==========================================================================
let logoClickCount = 0;
let logoClickTimer = null;
let adminPollInterval = null;
let adminDepositsPollInterval = null;
let currentAdminPasscode = ""; // Cached on successful unlock
let currentAdminDeposits = [];
let adminFilterPreset = 'all';
let adminFilterFrom = '';
let adminFilterTo = '';
let adminFilterSearch = '';
let adminFilterDebounce = null;
let adminUsersList = [];
let adminUserSearch = '';
let adminUserSearchDebounce = null;

function handleBrandLogoClick(event) {
  event.preventDefault();
  logoClickCount++;
  
  if (logoClickTimer) clearTimeout(logoClickTimer);
  logoClickTimer = setTimeout(() => {
    logoClickCount = 0;
  }, 3000); // Reset count if not clicked 5 times within 3 seconds
  
  if (logoClickCount >= 5) {
    logoClickCount = 0;
    clearTimeout(logoClickTimer);
    openAdminPredictorModal();
  }
}

function openAdminPredictorModal() {
  document.getElementById("adminPredictorModal").classList.add("active");
  
  // Set target phone value
  let guestId = localStorage.getItem("helakash_guest_id");
  if (!guestId) {
    guestId = `guest_${Math.random().toString(36).substring(2, 9)}`;
    localStorage.setItem("helakash_guest_id", guestId);
  }
  const phone = localStorage.getItem("helakash_user") || guestId;
  document.getElementById("adminTargetPhone").value = phone;
  
  // Reset tabs and settings view to locked state on modal open
  switchAdminTab('predictor');
  
  document.getElementById("adminLockView").classList.remove("hidden");
  document.getElementById("adminConfigView").classList.add("hidden");
  const usersLockView = document.getElementById("adminUsersLockView");
  if (usersLockView) usersLockView.classList.remove("hidden");
  const usersContentView = document.getElementById("adminUsersContentView");
  if (usersContentView) usersContentView.classList.add("hidden");

  document.getElementById("adminPasscodeInput").value = "";
  document.getElementById("adminUnlockError").classList.add("hidden");
  currentAdminPasscode = ""; // Clear cached passcode
  currentAdminDeposits = [];
  adminUsersList = [];
  adminFilterPreset = 'all';
  adminFilterFrom = '';
  adminFilterTo = '';
  adminFilterSearch = '';
  adminUserSearch = '';

  // Reset chips active classes
  document.querySelectorAll('.admin-chip').forEach(chip => chip.classList.remove('active'));
  const allChip = document.getElementById("chipAll");
  if (allChip) allChip.classList.add("active");
  const customBox = document.getElementById("adminCustomRangeBox");
  if (customBox) customBox.classList.add("hidden");

  fetchAdminNextCrash();
  
  // Start polling every second while the modal is open
  if (adminPollInterval) clearInterval(adminPollInterval);
  adminPollInterval = setInterval(fetchAdminNextCrash, 1000);
}

function closeAdminPredictorModal() {
  document.getElementById("adminPredictorModal").classList.remove("active");
  if (adminPollInterval) {
    clearInterval(adminPollInterval);
    adminPollInterval = null;
  }
  if (adminDepositsPollInterval) {
    clearInterval(adminDepositsPollInterval);
    adminDepositsPollInterval = null;
  }
}

function fetchAdminNextCrash() {
  const phone = document.getElementById("adminTargetPhone").value;
  if (!phone) return;
  
  fetch(`/api/next-crash?phone=${encodeURIComponent(phone)}`)
    .then(res => res.json())
    .then(data => {
      if (data.success && data.crash_point) {
        document.getElementById("adminNextCrashVal").textContent = `x${data.crash_point.toFixed(2)}`;
        document.getElementById("adminNextCrashVal").style.color = "var(--primary)";
        
        if (data.crash_point_2) {
          document.getElementById("adminNextCrashVal2").textContent = `x${data.crash_point_2.toFixed(2)}`;
        } else {
          document.getElementById("adminNextCrashVal2").textContent = "x?.??";
        }
        
        if (data.crash_point_3) {
          document.getElementById("adminNextCrashVal3").textContent = `x${data.crash_point_3.toFixed(2)}`;
        } else {
          document.getElementById("adminNextCrashVal3").textContent = "x?.??";
        }
      } else {
        document.getElementById("adminNextCrashVal").textContent = "x?.??";
        document.getElementById("adminNextCrashVal").style.color = "var(--text-gray)";
        document.getElementById("adminNextCrashVal2").textContent = "x?.??";
        document.getElementById("adminNextCrashVal3").textContent = "x?.??";
      }
    })
    .catch(err => {
      console.error("Admin predictor error:", err);
      document.getElementById("adminNextCrashVal").textContent = "Error";
      document.getElementById("adminNextCrashVal").style.color = "var(--danger)";
      document.getElementById("adminNextCrashVal2").textContent = "Error";
      document.getElementById("adminNextCrashVal3").textContent = "Error";
    });
}

// Switch between predictor, settings, and users tabs in admin panel
function switchAdminTab(tabName) {
  const tabPredictor = document.getElementById("tabBtnPredictor");
  const tabSettings = document.getElementById("tabBtnSettings");
  const tabUsers = document.getElementById("tabBtnUsers");
  const viewPredictor = document.getElementById("adminPredictorTabView");
  const viewSettings = document.getElementById("adminSettingsTabView");
  const viewUsers = document.getElementById("adminUsersTabView");
  
  if (tabPredictor) tabPredictor.classList.remove("active");
  if (tabSettings) tabSettings.classList.remove("active");
  if (tabUsers) tabUsers.classList.remove("active");
  if (viewPredictor) viewPredictor.classList.add("hidden");
  if (viewSettings) viewSettings.classList.add("hidden");
  if (viewUsers) viewUsers.classList.add("hidden");

  if (tabName === 'predictor') {
    if (tabPredictor) tabPredictor.classList.add("active");
    if (viewPredictor) viewPredictor.classList.remove("hidden");
  } else if (tabName === 'settings') {
    if (tabSettings) tabSettings.classList.add("active");
    if (viewSettings) viewSettings.classList.remove("hidden");

    if (currentAdminPasscode) {
      document.getElementById("adminLockView").classList.add("hidden");
      document.getElementById("adminConfigView").classList.remove("hidden");
      refreshAdminDeposits(false);
    } else {
      document.getElementById("adminLockView").classList.remove("hidden");
      document.getElementById("adminConfigView").classList.add("hidden");
    }
  } else if (tabName === 'users') {
    if (tabUsers) tabUsers.classList.add("active");
    if (viewUsers) viewUsers.classList.remove("hidden");

    if (currentAdminPasscode) {
      document.getElementById("adminUsersLockView").classList.add("hidden");
      document.getElementById("adminUsersContentView").classList.remove("hidden");
      refreshAdminUsers(false);
    } else {
      document.getElementById("adminUsersLockView").classList.remove("hidden");
      document.getElementById("adminUsersContentView").classList.add("hidden");
    }
  }
}

// Format admin deposit phone number (e.g. 0746568134, 0114468686)
function formatAdminDepositPhone(phone) {
  if (!phone) return '0700000000';
  let p = String(phone).trim();
  if (p.startsWith('254') && p.length === 12) {
    return '0' + p.substring(3);
  }
  if (p.startsWith('+254')) {
    return '0' + p.substring(4);
  }
  return p;
}

// Format admin deposit amount (e.g. +300, +5)
function formatAdminDepositAmount(amt) {
  const num = parseFloat(amt);
  if (isNaN(num)) return '+0';
  return `+${num % 1 === 0 ? num.toLocaleString() : num.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
}

// Format admin deposit timestamp (24-hour HH:mm matching DB deposit time)
function formatAdminDepositTime(deposit) {
  if (!deposit) return '--:--';
  if (deposit.db_time && typeof deposit.db_time === 'string' && deposit.db_time.includes(':')) {
    return deposit.db_time.trim();
  }
  if (deposit.time && typeof deposit.time === 'string' && deposit.time.includes(':')) {
    return deposit.time.trim();
  }
  
  const dateVal = deposit.created_at || deposit.date || deposit.raw_time || deposit;
  if (!dateVal) return '--:--';
  
  const d = new Date(dateVal);
  if (!isNaN(d.getTime())) {
    try {
      return d.toLocaleTimeString('en-GB', {
        timeZone: 'Africa/Nairobi',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    } catch (e) {
      return d.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    }
  }
  
  if (typeof dateVal === 'string') {
    const match = dateVal.match(/(\d{2}:\d{2})/);
    if (match) return match[1];
  }
  
  return '--:--';
}

// Render dynamic list of successful deposits in the admin control center matching the screenshot table
function renderAdminDepositsList(deposits) {
  const depListEl = document.getElementById("adminDepositsList");
  if (!depListEl) return;
  
  if (!deposits || deposits.length === 0) {
    depListEl.innerHTML = '<tr><td colspan="4" style="padding: 24px 0; text-align: center; color: #8e9ba7; font-size: 12px;">No matching deposits found.</td></tr>';
    return;
  }

  depListEl.innerHTML = deposits.map(d => {
    const formattedPhone = formatAdminDepositPhone(d.phone);
    const formattedAmt = formatAdminDepositAmount(d.amount);
    const ref = d.reference || 'N/A';
    const formattedTime = formatAdminDepositTime(d);

    return `
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
        <td style="padding: 12px 4px 12px 0; color: #ffffff; font-weight: 700; font-size: 13px; font-family: monospace, inherit; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${formattedPhone}</td>
        <td style="padding: 12px 4px; color: #10b981; font-weight: 700; font-size: 13px; white-space: nowrap;">${formattedAmt}</td>
        <td style="padding: 12px 4px; color: #94a3b8; font-size: 11px; font-family: monospace, inherit; letter-spacing: 0.3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${ref}</td>
        <td style="padding: 12px 0 12px 4px; color: #8e9ba7; font-size: 12px; font-family: monospace, inherit; text-align: right; white-space: nowrap;">${formattedTime}</td>
      </tr>
    `;
  }).join('');
}

// Set time-window filter preset (All Time, Today, Last 1h, Last 6h, Last 24h, Yesterday, Custom Range)
function setDepositFilterPreset(preset) {
  adminFilterPreset = preset;
  
  // Highlight active chip
  document.querySelectorAll('.admin-filter-chips .admin-chip').forEach(chip => chip.classList.remove('active'));
  const chipMap = {
    'all': 'chipAll',
    'today': 'chipToday',
    '1h': 'chip1h',
    '6h': 'chip6h',
    '24h': 'chip24h',
    'yesterday': 'chipYesterday',
    'custom': 'chipCustom'
  };
  const activeChipEl = document.getElementById(chipMap[preset]);
  if (activeChipEl) activeChipEl.classList.add('active');

  const customBox = document.getElementById("adminCustomRangeBox");

  const now = new Date();

  if (preset === 'all') {
    adminFilterFrom = '';
    adminFilterTo = '';
    if (customBox) customBox.classList.add("hidden");
  } else if (preset === 'today') {
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    adminFilterFrom = todayStart.toISOString();
    adminFilterTo = now.toISOString();
    if (customBox) customBox.classList.add("hidden");
  } else if (preset === '1h') {
    adminFilterFrom = new Date(now.getTime() - 3600000).toISOString();
    adminFilterTo = now.toISOString();
    if (customBox) customBox.classList.add("hidden");
  } else if (preset === '6h') {
    adminFilterFrom = new Date(now.getTime() - 3600000 * 6).toISOString();
    adminFilterTo = now.toISOString();
    if (customBox) customBox.classList.add("hidden");
  } else if (preset === '24h') {
    adminFilterFrom = new Date(now.getTime() - 3600000 * 24).toISOString();
    adminFilterTo = now.toISOString();
    if (customBox) customBox.classList.add("hidden");
  } else if (preset === 'yesterday') {
    const yStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0);
    const yEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
    adminFilterFrom = yStart.toISOString();
    adminFilterTo = yEnd.toISOString();
    if (customBox) customBox.classList.add("hidden");
  } else if (preset === 'custom') {
    if (customBox) customBox.classList.toggle("hidden");
    return; // Wait for user to input datetime and click apply
  }

  refreshAdminDeposits(false);
}

// Apply custom datetime-local filter
function applyCustomDepositFilter() {
  const fromVal = document.getElementById("adminDepFrom")?.value;
  const toVal = document.getElementById("adminDepTo")?.value;

  if (fromVal) {
    adminFilterFrom = new Date(fromVal).toISOString();
  } else {
    adminFilterFrom = '';
  }

  if (toVal) {
    adminFilterTo = new Date(toVal).toISOString();
  } else {
    adminFilterTo = '';
  }

  refreshAdminDeposits(false);
}

// Clear custom datetime-local filter
function clearCustomDepositFilter() {
  const fromEl = document.getElementById("adminDepFrom");
  const toEl = document.getElementById("adminDepTo");
  if (fromEl) fromEl.value = '';
  if (toEl) toEl.value = '';
  setDepositFilterPreset('all');
}

// Real-time Search input for deposits (phone or reference)
function handleDepositSearchInput(event) {
  adminFilterSearch = (event.target.value || '').trim();
  if (adminFilterDebounce) clearTimeout(adminFilterDebounce);
  adminFilterDebounce = setTimeout(() => {
    refreshAdminDeposits(false);
  }, 250);
}

// Refresh admin deposits from server in real-time with filter parameters & stats
function refreshAdminDeposits(isManual = false) {
  if (!currentAdminPasscode) return;
  
  const refreshBtn = document.getElementById("adminDepositsRefreshBtn");
  if (isManual && refreshBtn) {
    refreshBtn.style.opacity = '0.5';
    refreshBtn.style.pointerEvents = 'none';
  }
  
  const queryParams = new URLSearchParams({
    passcode: currentAdminPasscode,
    limit: '100'
  });
  if (adminFilterFrom) queryParams.set('from', adminFilterFrom);
  if (adminFilterTo) queryParams.set('to', adminFilterTo);
  if (adminFilterSearch) queryParams.set('search', adminFilterSearch);

  fetch(`/api/settings?${queryParams.toString()}`)
    .then(res => res.json())
    .then(data => {
      if (isManual && refreshBtn) {
        refreshBtn.style.opacity = '1';
        refreshBtn.style.pointerEvents = 'auto';
      }
      if (data.success && data.authenticated && data.deposits) {
        currentAdminDeposits = data.deposits;
        renderAdminDepositsList(data.deposits);

        // Update Dynamic Volume Summary Badges
        if (data.deposit_stats) {
          const filtVol = document.getElementById("adminFilteredVolume");
          const filtCnt = document.getElementById("adminFilteredCount");
          const todayVol = document.getElementById("adminTodayVolume");

          if (filtVol) {
            filtVol.textContent = `KES ${data.deposit_stats.filtered_total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
          }
          if (filtCnt) {
            const count = data.deposit_stats.filtered_count;
            filtCnt.textContent = `${count} ${count === 1 ? 'Deposit' : 'Deposits'}`;
          }
          if (todayVol) {
            todayVol.textContent = `KES ${data.deposit_stats.today_total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
          }
        }
      }
    })
    .catch(err => {
      console.error("Error refreshing admin deposits:", err);
      if (isManual && refreshBtn) {
        refreshBtn.style.opacity = '1';
        refreshBtn.style.pointerEvents = 'auto';
      }
    });
}

// Unlock system settings & admin features
function unlockAdminSettings() {
  const passcode = document.getElementById("adminPasscodeInput").value;
  const errorEl = document.getElementById("adminUnlockError");
  
  if (!passcode) {
    errorEl.textContent = "Please enter a passcode.";
    errorEl.classList.remove("hidden");
    return;
  }
  
  fetch(`/api/settings?passcode=${encodeURIComponent(passcode)}`)
    .then(res => res.json())
    .then(data => {
      if (data.success && data.authenticated) {
        currentAdminPasscode = passcode;
        errorEl.classList.add("hidden");
        
        // Show Settings View
        document.getElementById("adminLockView").classList.add("hidden");
        document.getElementById("adminConfigView").classList.remove("hidden");

        // Unlock Users View
        const usersLockView = document.getElementById("adminUsersLockView");
        if (usersLockView) usersLockView.classList.add("hidden");
        const usersContentView = document.getElementById("adminUsersContentView");
        if (usersContentView) usersContentView.classList.remove("hidden");
        
        // Populate inputs
        document.getElementById("adminMinDepositInput").value = data.min_deposit;
        document.getElementById("adminMinWithdrawalInput").value = data.min_withdrawal;
        document.getElementById("adminMinStakeInput").value = data.min_stake;
        
        const activeGw = (data.active_gateway || 'payhero').toLowerCase();
        const activeGwSelect = document.getElementById("adminActiveGatewaySelect");
        if (activeGwSelect) activeGwSelect.value = activeGw;

        document.getElementById("adminPayHeroUsernameInput").value = data.payhero_username || '';
        document.getElementById("adminPayHeroPasswordInput").value = data.payhero_password || '';
        document.getElementById("adminPayHeroChannelIdInput").value = data.payhero_channel_id || '';
        document.getElementById("adminPayHeroCallbackUrlInput").value = data.payhero_callback_url || '';
        
        const tinyApiKey = document.getElementById("adminTinyPesaApiKeyInput");
        if (tinyApiKey) tinyApiKey.value = data.tinypesa_api_key || '';
        const tinyAccountNo = document.getElementById("adminTinyPesaAccountNoInput");
        if (tinyAccountNo) tinyAccountNo.value = data.tinypesa_account_no || '';
        
        // Populate overrides values if present
        document.getElementById("overrideCp").value = data.crash_point.toFixed(2);
        document.getElementById("overrideCp2").value = data.crash_point_2.toFixed(2);
        document.getElementById("overrideCp3").value = data.crash_point_3.toFixed(2);
        
        // Populate successful deposits log with real-time formatting & badges
        currentAdminDeposits = data.deposits || [];
        renderAdminDepositsList(currentAdminDeposits);

        if (data.deposit_stats) {
          const filtVol = document.getElementById("adminFilteredVolume");
          const filtCnt = document.getElementById("adminFilteredCount");
          const todayVol = document.getElementById("adminTodayVolume");
          if (filtVol) filtVol.textContent = `KES ${data.deposit_stats.filtered_total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
          if (filtCnt) filtCnt.textContent = `${data.deposit_stats.filtered_count} Deposits`;
          if (todayVol) todayVol.textContent = `KES ${data.deposit_stats.today_total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        }

        // Populate users directory
        if (data.users) {
          adminUsersList = data.users;
          renderAdminUsersList(data.users);
        }

        // Start live polling every 4 seconds while on settings tab
        if (adminDepositsPollInterval) clearInterval(adminDepositsPollInterval);
        adminDepositsPollInterval = setInterval(() => {
          const configView = document.getElementById("adminConfigView");
          if (configView && !configView.classList.contains("hidden")) {
            refreshAdminDeposits(false);
          }
        }, 4000);
      } else {
        errorEl.textContent = "Invalid passcode. Access Denied.";
        errorEl.classList.remove("hidden");
      }
    })
    .catch(err => {
      console.error("Unlock error:", err);
      errorEl.textContent = "Server connection error.";
      errorEl.classList.remove("hidden");
    });
}

// ==========================================================================
// FEATURE 2: ADMIN USERS DIRECTORY & INSTANT TOP-UP FUNCTIONS
// ==========================================================================

// Pre-fill target phone with currently logged-in account
function fillActivePlayerPhone() {
  const userPhone = localStorage.getItem("helakash_user");
  const phoneInput = document.getElementById("adminTopupPhone");
  if (userPhone && phoneInput) {
    phoneInput.value = userPhone;
    phoneInput.focus();
  } else {
    alert("No active logged-in player session found in this browser. Please enter a phone number manually.");
  }
}

// Set or add top-up amount preset (+100, +500, +1000, +2500, +5000)
function setTopupAmountPreset(amt) {
  const amtInput = document.getElementById("adminTopupAmount");
  if (!amtInput) return;
  amtInput.value = amt;
  amtInput.focus();
}

// Shortcut from table: pre-fill phone into top-up form
function fillTopupUser(phone) {
  const phoneInput = document.getElementById("adminTopupPhone");
  const amtInput = document.getElementById("adminTopupAmount");
  if (phoneInput) phoneInput.value = phone;
  if (amtInput) {
    amtInput.focus();
    amtInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// Format date for registered users list
function formatUserRegDate(dateVal) {
  if (!dateVal) return '--';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return String(dateVal).substring(0, 10);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

// Render registered users directory table
function renderAdminUsersList(users) {
  const usersListEl = document.getElementById("adminUsersList");
  if (!usersListEl) return;

  if (!users || users.length === 0) {
    usersListEl.innerHTML = '<tr><td colspan="4" style="padding: 24px 0; text-align: center; color: #8e9ba7; font-size: 12px;">No registered users found.</td></tr>';
    return;
  }

  usersListEl.innerHTML = users.map(u => {
    const formattedPhone = formatAdminDepositPhone(u.phone);
    const formattedBal = `KES ${parseFloat(u.balance || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    const joined = formatUserRegDate(u.created_at);

    return `
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
        <td style="padding: 12px 4px 12px 0; color: #ffffff; font-weight: 700; font-size: 13px; font-family: monospace, inherit; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${formattedPhone}</td>
        <td style="padding: 12px 4px; color: #10b981; font-weight: 700; font-size: 13px; white-space: nowrap;">${formattedBal}</td>
        <td style="padding: 12px 4px; color: #94a3b8; font-size: 11px; white-space: nowrap;">${joined}</td>
        <td style="padding: 12px 0 12px 4px; text-align: right; white-space: nowrap;">
          <button type="button" class="admin-inline-btn" onclick="fillTopupUser('${u.phone}')" title="Top up balance for ${formattedPhone}">
            + Top Up
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// Real-time Search registered users directory
function handleUserSearchInput(event) {
  adminUserSearch = (event.target.value || '').trim();
  if (adminUserSearchDebounce) clearTimeout(adminUserSearchDebounce);
  adminUserSearchDebounce = setTimeout(() => {
    refreshAdminUsers(false);
  }, 250);
}

// Refresh users directory from server
function refreshAdminUsers(isManual = false) {
  if (!currentAdminPasscode) return;

  const refreshBtn = document.getElementById("adminUsersRefreshBtn");
  if (isManual && refreshBtn) {
    refreshBtn.style.opacity = '0.5';
    refreshBtn.style.pointerEvents = 'none';
  }

  const queryParams = new URLSearchParams({
    passcode: currentAdminPasscode
  });
  if (adminUserSearch) queryParams.set('user_search', adminUserSearch);

  fetch(`/api/settings?${queryParams.toString()}`)
    .then(res => res.json())
    .then(data => {
      if (isManual && refreshBtn) {
        refreshBtn.style.opacity = '1';
        refreshBtn.style.pointerEvents = 'auto';
      }
      if (data.success && data.authenticated && data.users) {
        adminUsersList = data.users;
        renderAdminUsersList(data.users);
      }
    })
    .catch(err => {
      console.error("Error refreshing admin users:", err);
      if (isManual && refreshBtn) {
        refreshBtn.style.opacity = '1';
        refreshBtn.style.pointerEvents = 'auto';
      }
    });
}

// Handle Submit for Quick Top-Up Action Console
function handleAdminTopupSubmit(event) {
  if (event) event.preventDefault();

  if (!currentAdminPasscode) {
    alert("Please unlock the admin panel with your passcode first.");
    switchAdminTab('settings');
    return;
  }

  const targetPhone = document.getElementById("adminTopupPhone")?.value.trim();
  const amount = parseFloat(document.getElementById("adminTopupAmount")?.value);
  const feedbackEl = document.getElementById("adminTopupFeedback");
  const creditBtn = document.getElementById("btnAdminCredit");

  if (!targetPhone) {
    if (feedbackEl) {
      feedbackEl.className = "admin-status-feedback error";
      feedbackEl.textContent = "Please enter a target phone number.";
      feedbackEl.classList.remove("hidden");
    }
    return;
  }

  if (isNaN(amount) || amount <= 0) {
    if (feedbackEl) {
      feedbackEl.className = "admin-status-feedback error";
      feedbackEl.textContent = "Please enter a valid positive amount (e.g. 500).";
      feedbackEl.classList.remove("hidden");
    }
    return;
  }

  if (creditBtn) {
    creditBtn.disabled = true;
    creditBtn.textContent = "⚡ Crediting Account...";
  }

  fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      passcode: currentAdminPasscode,
      action: 'topup_user',
      target_phone: targetPhone,
      amount: amount
    })
  })
  .then(res => res.json())
  .then(data => {
    if (creditBtn) {
      creditBtn.disabled = false;
      creditBtn.textContent = "⚡ Credit Account / Add Balance";
    }

    if (data.success) {
      const formattedAmt = `KES ${parseFloat(data.amount_credited || amount).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
      const formattedNewBal = `KES ${parseFloat(data.new_balance || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

      if (feedbackEl) {
        feedbackEl.className = "admin-status-feedback success";
        feedbackEl.innerHTML = `✅ <strong>Success!</strong> Credited ${formattedAmt} to <strong>${data.phone}</strong>.<br>Updated Balance: <strong>${formattedNewBal}</strong>`;
        feedbackEl.classList.remove("hidden");
      }

      // Clear amount field
      const amtInput = document.getElementById("adminTopupAmount");
      if (amtInput) amtInput.value = '';

      // If credited phone matches the currently active user session, automatically update local userBalance & header in real time
      const currentActiveUser = localStorage.getItem("helakash_user");
      if (currentActiveUser) {
        const rawCurrent = currentActiveUser.replace(/\D/g, '');
        const rawCredited = String(data.phone).replace(/\D/g, '');
        const isSameUser = rawCurrent === rawCredited || (rawCurrent.length >= 9 && rawCredited.endsWith(rawCurrent.slice(-9)));

        if (isSameUser && typeof data.new_balance === 'number') {
          userBalance = data.new_balance;
          saveBalance();
          updateBalanceUI();
          console.log(`[Admin Real-time Sync] Active session balance updated to KES ${userBalance}`);
        }
      }

      // Refresh directory and deposit history in real-time
      refreshAdminUsers(false);
      refreshAdminDeposits(false);

    } else {
      if (feedbackEl) {
        feedbackEl.className = "admin-status-feedback error";
        feedbackEl.textContent = `❌ ${data.error || 'Failed to credit account.'}`;
        feedbackEl.classList.remove("hidden");
      }
    }
  })
  .catch(err => {
    console.error("Top-up request error:", err);
    if (creditBtn) {
      creditBtn.disabled = false;
      creditBtn.textContent = "⚡ Credit Account / Add Balance";
    }
    if (feedbackEl) {
      feedbackEl.className = "admin-status-feedback error";
      feedbackEl.textContent = "❌ Connection error: Could not reach server.";
      feedbackEl.classList.remove("hidden");
    }
  });
}

// Quick preset outcome override
function adminQuickOverride(val) {
  const overrideInput = document.getElementById("overrideCp");
  if (overrideInput) {
    overrideInput.value = parseFloat(val).toFixed(2);
  }
}

// Force outcomes (Win / Loss next round)
function forceAdminOutcome(type) {
  if (type === 'win') {
    adminQuickOverride(10.00);
  } else {
    adminQuickOverride(1.00);
  }
}

// Save custom crash override points
function saveCrashOverrides() {
  if (!currentAdminPasscode) {
    alert("Please unlock Settings tab first by entering your passcode.");
    switchAdminTab('settings');
    return;
  }
  
  const cp = parseFloat(document.getElementById("overrideCp").value);
  const cp2 = parseFloat(document.getElementById("overrideCp2").value);
  const cp3 = parseFloat(document.getElementById("overrideCp3").value);
  
  if (isNaN(cp) || cp < 1.0 || isNaN(cp2) || cp2 < 1.0 || isNaN(cp3) || cp3 < 1.0) {
    alert("Please enter valid positive numbers (>= 1.00) for all override points.");
    return;
  }
  
  fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      passcode: currentAdminPasscode,
      crash_point: cp,
      crash_point_2: cp2,
      crash_point_3: cp3
    })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      alert("✅ Success: Crash override points successfully updated in the database!");
      fetchAdminNextCrash();
    } else {
      alert(`Error saving overrides: ${data.error}`);
    }
  })
  .catch(err => {
    console.error("Error override save:", err);
    alert("Connection error: Failed to save overrides.");
  });
}

// Handle general settings submission
function handleAdminSettingsSubmit(event) {
  event.preventDefault();
  
  if (!currentAdminPasscode) {
    alert("Please unlock Settings first.");
    return;
  }
  
  const payload = {
    passcode: currentAdminPasscode,
    min_deposit: parseFloat(document.getElementById("adminMinDepositInput").value),
    min_withdrawal: parseFloat(document.getElementById("adminMinWithdrawalInput").value),
    min_stake: parseFloat(document.getElementById("adminMinStakeInput").value),
    active_gateway: (document.getElementById("adminActiveGatewaySelect")?.value || 'payhero').toLowerCase(),
    payhero_username: document.getElementById("adminPayHeroUsernameInput").value.trim(),
    payhero_password: document.getElementById("adminPayHeroPasswordInput").value.trim(),
    payhero_channel_id: document.getElementById("adminPayHeroChannelIdInput").value.trim(),
    payhero_callback_url: document.getElementById("adminPayHeroCallbackUrlInput").value.trim(),
    tinypesa_api_key: document.getElementById("adminTinyPesaApiKeyInput")?.value.trim() || '',
    tinypesa_account_no: document.getElementById("adminTinyPesaAccountNoInput")?.value.trim() || ''
  };
  
  // Handle passcode change
  const newPasscode = document.getElementById("adminNewPasscodeInput").value.trim();
  if (newPasscode) {
    payload.admin_passcode = newPasscode;
  }
  
  fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      alert("✅ Success: System settings saved and limits applied!");
      if (newPasscode) {
        currentAdminPasscode = newPasscode; // Update cached passcode
        document.getElementById("adminNewPasscodeInput").value = "";
      }
      loadSystemSettings(); // Apply new limits to page dynamically
    } else {
      alert(`Error saving settings: ${data.error}`);
    }
  })
  .catch(err => {
    console.error("Error settings save:", err);
    alert("Connection error: Failed to save settings.");
  });
}

// Load public system settings and update the DOM
function loadSystemSettings() {
  fetch('/api/settings')
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        minDepositLimit = data.min_deposit || 300;
        minWithdrawalLimit = data.min_withdrawal || 500;
        minStakeLimit = data.min_stake || 400;

        // Dynamic placeholder & min updates
        const depAmt = document.getElementById("depositAmount");
        if (depAmt) {
          depAmt.min = minDepositLimit;
          depAmt.placeholder = `Min ${minDepositLimit}`;
        }

        const wdAmt = document.getElementById("withdrawAmount");
        if (wdAmt) {
          wdAmt.min = minWithdrawalLimit;
          wdAmt.placeholder = `e.g. ${minWithdrawalLimit}`;
        }
        const wdHelp = document.querySelector("#withdrawForm .stk-desc");
        if (wdHelp) {
          wdHelp.textContent = `Min limit is KES ${minWithdrawalLimit}. Processing is automated.`;
        }

        const betInputA = document.getElementById("betAmountA");
        if (betInputA) {
          betInputA.min = minStakeLimit;
          if (parseInt(betInputA.value) < minStakeLimit) {
            betAmountA = minStakeLimit;
            betInputA.value = minStakeLimit;
            updateConsoleButtonLabel('A');
          }
        }
        const betInputB = document.getElementById("betAmountB");
        if (betInputB) {
          betInputB.min = minStakeLimit;
          if (parseInt(betInputB.value) < minStakeLimit) {
            betAmountB = minStakeLimit;
            betInputB.value = minStakeLimit;
            updateConsoleButtonLabel('B');
          }
        }

        const minesBet = document.getElementById("minesBetInput");
        if (minesBet) {
          minesBet.min = minStakeLimit;
          if (parseInt(minesBet.value) < minStakeLimit) {
            minesBet.value = minStakeLimit;
          }
        }
      }
    })
    .catch(err => console.error("Error loading system settings:", err));
}
