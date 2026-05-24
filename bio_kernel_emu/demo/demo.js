// bio_kernel_emu — Demo logika
// INERT/ACTIVE vizuális váltás, kamera szimuláció, audit feed

(function () {
    // ── Kernel inicializálás ──
    const kernel = new BioKernelEmu();
    kernel.start(document.body);

    // ── DOM elemek ──
    const body        = document.body;
    const stateBadge  = document.getElementById('state-badge');
    const stateLabel  = document.getElementById('state-label');
    const triggerBtn  = document.getElementById('trigger-btn');
    const auditLogEl  = document.getElementById('audit-log');
    const eventCount  = document.getElementById('event-count');
    const cameraStatus= document.getElementById('camera-status');
    const netStatus   = document.getElementById('net-status');
    const browserUrl  = document.getElementById('browser-url');
    const canvas      = document.getElementById('camera-canvas');
    const ctx         = canvas.getContext('2d');

    let eventTotal = 0;
    let animFrame  = null;
    let isActive   = false;

    // ── Kamera canvas méretezés ──
    function resizeCanvas() {
        canvas.width  = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // ── INERT kamera: fekete ──
    function drawInert() {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // ENODEV felirat
        ctx.fillStyle = 'rgba(192,57,43,0.3)';
        ctx.font = '12px Courier New';
        ctx.textAlign = 'center';
        ctx.fillText('ENODEV', canvas.width / 2, canvas.height / 2);
    }

    // ── ACTIVE kamera: élő feed szimuláció ──
    let t = 0;
    function drawActive() {
        t += 0.02;
        const w = canvas.width, h = canvas.height;

        // Alap gradient — zöld tónus (aktív állapot szimbolikája)
        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0,   `hsl(${140 + Math.sin(t) * 10}, 50%, 8%)`);
        grad.addColorStop(0.5, `hsl(${150 + Math.cos(t * 0.7) * 8}, 40%, 12%)`);
        grad.addColorStop(1,   `hsl(${130 + Math.sin(t * 1.3) * 12}, 45%, 6%)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        // Scan-line effekt — CRT / kamera monitor feeling
        ctx.strokeStyle = 'rgba(39,174,96,0.04)';
        ctx.lineWidth = 1;
        for (let y = 0; y < h; y += 3) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        // Mozgó "signal" pont — él a feed
        const sx = w * 0.5 + Math.sin(t * 1.2) * w * 0.3;
        const sy = h * 0.5 + Math.cos(t * 0.8) * h * 0.25;
        const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 60);
        glow.addColorStop(0, 'rgba(39,174,96,0.5)');
        glow.addColorStop(1, 'rgba(39,174,96,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);

        // "LIVE" felirat
        ctx.fillStyle = 'rgba(39,174,96,0.8)';
        ctx.font = '11px Courier New';
        ctx.textAlign = 'left';
        ctx.fillText('● LIVE', 12, 20);

        // Timestamp
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(39,174,96,0.5)';
        ctx.fillText(new Date().toISOString().slice(11, 23), w - 12, 20);

        animFrame = requestAnimationFrame(drawActive);
    }

    // ── Állapotváltás kezelése ──
    kernel.onStateChange((from, to) => {
        isActive = (to === 1);

        if (isActive) {
            // INERT → ACTIVE
            body.className = 'active';
            stateBadge.className = 'state-badge active';
            stateLabel.textContent = 'STATE_ACTIVE';
            cameraStatus.style.color = 'var(--active-color)';
            cameraStatus.textContent = 'LIVE';
            netStatus.style.color = 'var(--active-color)';
            netStatus.textContent = 'CONNECTED';
            browserUrl.textContent = 'https://metaspace.bio/';
            triggerBtn.textContent = '✓ AKTÍV — érintés az újraindításhoz';

            if (animFrame) cancelAnimationFrame(animFrame);
            drawActive();

        } else {
            // ACTIVE → INERT
            body.className = 'inert';
            stateBadge.className = 'state-badge inert';
            stateLabel.textContent = 'STATE_INERT';
            cameraStatus.style.color = 'var(--inert-color)';
            cameraStatus.textContent = 'ENODEV';
            netStatus.style.color = 'var(--inert-color)';
            netStatus.textContent = 'ECONNREFUSED';
            browserUrl.textContent = 'about:blank — No Causal Chain';
            triggerBtn.textContent = '⚡ FIZIKAI ÉRINTÉS — KAUZÁLIS LÁNC AKTIVÁLÁSA';

            if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
            drawInert();
        }
    });

    // ── Audit log megjelenítés ──
    kernel.onAuditEvent((ev) => {
        eventTotal++;
        eventCount.textContent = `${eventTotal} esemény`;

        const el = document.createElement('div');
        el.className = `audit-event ${ev.type}`;

        const time = new Date(ev.timestamp).toISOString().slice(11, 23);
        el.innerHTML = `<div class="audit-time">${time}</div>${ev.message}`;

        auditLogEl.appendChild(el);
        auditLogEl.scrollTop = auditLogEl.scrollHeight;

        // Max 60 esemény a DOM-ban
        while (auditLogEl.children.length > 60) {
            auditLogEl.removeChild(auditLogEl.firstChild);
        }
    });

    // ── Trigger gomb ──
    // A valódi kattintás isTrusted=true → ez a kauzális lánc első eleme
    triggerBtn.addEventListener('mousedown', async (e) => {
        // A gomb kattintása MAGA az IRQ — nem szimuláljuk, ez valódi fizikai esemény
        // A CausalIRQBridge a body-ra van kötve, ez a mousedown oda is felbuborékol

        // Resource-request demonstráció (a gomb megnyomása után)
        setTimeout(async () => {
            if (isActive) {
                await kernel.requestResource('file', 'camera_feed', 0x01);
                await kernel.requestResource('network', 'metaspace.bio', 0x02);
            }
        }, 50);
    });

    // ── Autonóm bot demonstráció ──
    // Szoftveres kísérlet erőforrás-hozzáférésre IRQ nélkül → mindig INERT marad
    setInterval(async () => {
        if (!isActive) {
            // Izomorf: headless szerver autonóm folyamata (nincs IRQ)
            const result = await kernel.requestResource('network', 'external-api', 0x02);
            // result.granted === false, result.errno === 111 (ECONNREFUSED)
        }
    }, 3000);

    // ── Kezdeti állapot ──
    drawInert();

})();
