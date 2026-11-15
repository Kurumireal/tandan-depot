// The DOM HUD: vitals, ammunition, money, the round clock and team score, the kill
// feed, banners, the buy menu, the channel bar and the full-screen overlays. It never
// touches the simulation; main.js pushes numbers in and reads callbacks out. Every
// setter is a no-op when the value has not changed, so the frame loop can push freely.
const $ = (id) => document.getElementById(id);

const OVERLAY_COPY = {
  start: {
    title: 'TANDAN — Depot Tactics',
    copy: 'Dusk at a palm-oil depot. You lead the Raiders: cross the container yard, plant the sabotage charge at the warehouse (A) or the tank farm (B), and hold until it blows. The Guards hold the depot — first team to 9 rounds takes it.',
    action: 'Click to play',
  },
  paused: { title: 'Paused', copy: 'The depot waits. Click to resume.', action: 'Click to resume' },
  matchRaiders: { title: 'Depot taken', copy: 'The Raiders win the match. The depot burns at dawn.', action: 'Play again' },
  matchGuards: { title: 'Depot held', copy: 'The Guards win the match. The charge never sang.', action: 'Play again' },
};

export function createHud() {
  const els = {
    health: $('health'), armorTag: $('armor-tag'), healthFill: $('health-fill'),
    money: $('money'), ammo: $('ammo'), ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'),
    weaponName: $('weapon-name'), grenades: $('grenades'), clock: $('clock'),
    scoreR: $('score-r'), scoreG: $('score-g'), roundNo: $('round-no'),
    aliveR: $('alive-r'), aliveG: $('alive-g'), killfeed: $('killfeed'),
    banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    chargeChip: $('charge-chip'), channel: $('channel'), channelFill: $('channel-fill'),
    channelLabel: $('channel-label'), damage: $('damage'), flash: $('flash'),
    scope: $('scope'), spectate: $('spectate'), hitmarker: $('hitmarker'),
    overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayCopy: $('overlay-copy'),
    play: $('play'), buy: $('buy'), buyGrid: $('buy-grid'), buyMoney: $('buy-money'),
  };
  const last = {};
  let bannerTimer = 0;
  let hitTimer = 0;

  return {
    setVitals(health, armor) {
      const h = Math.max(0, Math.ceil(health));
      if (last.health !== h) {
        last.health = h;
        els.health.textContent = String(h);
        els.health.classList.toggle('low', h <= 30);
        els.healthFill.style.width = `${h}%`;
        els.healthFill.classList.toggle('low', h <= 30);
      }
      const tag = armor ? 'KEVLAR' : '';
      if (last.armor !== tag) { last.armor = tag; els.armorTag.textContent = tag; }
    },
    setAmmo(mag, reserve, name) {
      if (last.mag !== mag || last.reserve !== reserve) {
        last.mag = mag; last.reserve = reserve;
        els.ammoMag.textContent = String(mag);
        els.ammoReserve.textContent = `/ ${reserve}`;
        els.ammo.classList.toggle('empty', mag === 0);
      }
      if (last.weapon !== name) { last.weapon = name; els.weaponName.textContent = name; }
    },
    setGrenades(text) {
      if (last.grenades !== text) { last.grenades = text; els.grenades.textContent = text; }
    },
    setMoney(value) {
      if (last.money !== value) { last.money = value; els.money.textContent = `$${value}`; }
    },
    setClock(seconds, hot) {
      const s = Math.max(0, Math.ceil(seconds));
      const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      if (last.clock !== text) { last.clock = text; els.clock.textContent = text; }
      els.clock.classList.toggle('hot', !!hot);
    },
    setScore(raiders, guards, round) {
      if (last.sr !== raiders) { last.sr = raiders; els.scoreR.textContent = String(raiders); }
      if (last.sg !== guards) { last.sg = guards; els.scoreG.textContent = String(guards); }
      if (last.round !== round) { last.round = round; els.roundNo.textContent = String(round); }
    },
    setAlive(raiders, guards) {
      const r = '●'.repeat(raiders) + '○'.repeat(5 - raiders);
      const g = '●'.repeat(guards) + '○'.repeat(5 - guards);
      if (last.alive !== r + g) { last.alive = r + g; els.aliveR.textContent = r; els.aliveG.textContent = g; }
    },
    killfeedLine(html) {
      const line = document.createElement('div');
      line.innerHTML = html;
      els.killfeed.prepend(line);
      while (els.killfeed.children.length > 5) els.killfeed.lastChild.remove();
      setTimeout(() => line.remove(), 5200);
    },
    banner(title, sub = '') {
      els.bannerTitle.textContent = title;
      els.bannerSub.textContent = sub;
      els.banner.classList.add('on');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => els.banner.classList.remove('on'), 3400);
    },
    clearBanner() {
      clearTimeout(bannerTimer);
      els.banner.classList.remove('on');
    },
    hitMarker(killed) {
      els.hitmarker.classList.add('on');
      els.hitmarker.style.transform = killed
        ? 'translate(-50%, -50%) rotate(45deg) scale(1.3)'
        : 'translate(-50%, -50%) rotate(45deg)';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => els.hitmarker.classList.remove('on'), killed ? 220 : 100);
    },
    damageFlash() {
      els.damage.style.opacity = '1';
      setTimeout(() => { els.damage.style.opacity = '0'; }, 130);
    },
    setFlash(strength) {
      els.flash.style.transition = 'none';
      els.flash.style.opacity = String(Math.min(1, strength));
      requestAnimationFrame(() => {
        els.flash.style.transition = 'opacity 2.4s linear';
        els.flash.style.opacity = '0';
      });
    },
    setScope(on) { els.scope.classList.toggle('on', !!on); },
    setChargeChip(on) { els.chargeChip.classList.toggle('on', !!on); },
    setSpectate(on) { els.spectate.classList.toggle('on', !!on); },
    setChannel(fraction, label) {
      if (fraction === null) {
        els.channel.classList.remove('on');
        return;
      }
      els.channel.classList.add('on');
      els.channelLabel.textContent = label;
      els.channelFill.style.width = `${Math.round(fraction * 100)}%`;
    },
    showBuy(items, money, onBuy) {
      els.buyMoney.textContent = `$${money}`;
      els.buyGrid.innerHTML = '';
      items.forEach((item, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'buy-item';
        button.disabled = !item.enabled;
        button.innerHTML = `<span class="key">${index + 1}</span><span class="nm">${item.name}</span><span class="pr">${item.detail}</span>`;
        button.addEventListener('click', () => onBuy(item.id));
        els.buyGrid.appendChild(button);
      });
      els.buy.classList.add('on');
    },
    refreshBuyMoney(money) { els.buyMoney.textContent = `$${money}`; },
    hideBuy() { els.buy.classList.remove('on'); },
    buyOpen() { return els.buy.classList.contains('on'); },
    showOverlay(mode) {
      const text = OVERLAY_COPY[mode];
      if (!text) return;
      els.overlayTitle.textContent = text.title;
      els.overlayCopy.textContent = text.copy;
      els.play.textContent = text.action;
      els.overlay.hidden = false;
      els.play.focus();
    },
    hideOverlay() { els.overlay.hidden = true; },
    onPlay(handler) { els.play.addEventListener('click', handler); },
  };
}
