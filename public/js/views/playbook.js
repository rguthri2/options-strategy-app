import { api } from '../api.js';
import { esc, loading, errorBox, biasPill } from '../ui.js';

export async function render(root) {
  root.innerHTML = `
    <div class="page-h"><div style="flex:1"><h1>Playbook</h1><div class="muted small">The rules the scanner and strategy engine apply. Adjust thresholds in <a href="#/settings">Settings</a>. Full explanations and worked examples: <a href="manual.html#options" target="_blank" rel="noopener">Training Manual ↗</a>.</div></div></div>
    <div class="grid g2" style="margin-bottom:16px">
      <section class="card">
        <div class="card-h"><h2>Strategy selection matrix</h2></div>
        <p class="help">Direction comes from the setup; the IV regime decides whether you <b>buy</b> or <b>sell</b> premium. This is the core of the tastytrade / Natenberg volatility framework.</p>
        <table class="t"><thead><tr><th class="l">Bias ↓ / IV →</th><th class="l">Cheap (IVR &lt; 25)</th><th class="l">Fair</th><th class="l">Rich (IVR ≥ 50)</th></tr></thead><tbody>
          <tr><td class="l">${biasPill('bull')}</td><td class="l">Long call 70Δ · LEAPS · PMCC</td><td class="l">Bull call debit spread</td><td class="l">Bull put credit · CSP (Wheel)</td></tr>
          <tr><td class="l">${biasPill('bear')}</td><td class="l">Long put 70Δ</td><td class="l">Bear put debit spread</td><td class="l">Bear call credit spread</td></tr>
          <tr><td class="l">${biasPill('neutral')}</td><td class="l">Stand aside / calendars</td><td class="l">Stand aside</td><td class="l">Iron condor 16Δ · short strangle</td></tr>
        </tbody></table>
      </section>
      <section class="card">
        <div class="card-h"><h2>How the Hot List scores a swing</h2></div>
        <ul class="help" style="padding-left:18px;display:grid;gap:6px;margin:0">
          <li><b>Trend (30 pts)</b> — Mark Minervini's 8-point Trend Template: price above rising 150/200-day SMAs, 50 &gt; 150 &gt; 200, ≥ 30% off the 52-week low, within 25% of the high, RS ≥ 70. The mirror-image template is used for shorts.</li>
          <li><b>Relative strength (25 pts)</b> — IBD-style weighted 3/6/9/12-month performance, ranked 1–99 across your universe.</li>
          <li><b>Setup (up to 25 pts)</b> — breakout above the 20-day high on ≥ 1.2× volume; VCP/pivot tightening (ATR contraction); Raschke-style pullback to a rising 21 EMA; TTM Squeeze (Bollinger inside Keltner) coiled or fired; momentum continuation. Bearish mirrors: breakdown, failed rally at the 21 EMA, squeeze fired down.</li>
          <li><b>Volume (10 pts)</b> — today's volume vs the 50-day average, weighted toward the direction of the move.</li>
          <li><b>Momentum (10 pts)</b> — RSI sweet spot 55–70 (30–45 for shorts); overbought prints are penalized so you don't chase.</li>
          <li><b>Neutral/range score</b> — low ADX, rich IV, price near the 20-day mean: iron condor candidates.</li>
          <li><b>Risk plan</b> — stop at the tighter of the 10-day swing low or 2 ATR (at least 1 ATR away); targets at 2R and 3R.</li>
        </ul>
      </section>
    </div>
    <section class="card" style="margin-bottom:16px">
      <div class="card-h"><h2>How trade ideas are scored (0–100)</h2></div>
      <div class="grid g3 help">
        <div><b>Setup fit (25)</b> — the hot-list directional/range score for the strategy's bias.<br><b>IV fit (15)</b> — credit trades want high IV Rank and IV &gt; HV; long premium wants low IVR.</div>
        <div><b>Trade quality (30)</b> — strategy-specific: credit ≥ ⅓ width, debit ≤ ½ width, 70Δ with low extrinsic and theta, PMCC debit &lt; 75% of width, CSP annualized yield.</div>
        <div><b>Edge (15)</b> — expected value under <i>realized</i> volatility vs capital at risk (buying cheap / selling rich vol).<br><b>Liquidity (15)</b> — open interest and bid/ask width on every leg.</div>
      </div>
    </section>
    <section class="card" style="margin-bottom:16px">
      <div class="card-h"><h2>Daily Scanner: trader setups</h2><span class="muted small">Each detector implements that trader's published rules; see the Daily Scanner tab</span></div>
      <div class="grid g2 help">
        <div><b>Qullamaggie (Kristjan Kullamägi): momentum breakout.</b> ADR ≥ 4%; a 30–100%+ move within ~1–3 months; a 2–8 week consolidation that tightens while price rides the 10/20-day MAs (stacked 10 ≥ 20 > 50). Buy the break of the range high on volume. Stop ≤ 1× ADR (the low of day or recent lows). Sell ⅓–½ after 3–5 days, move the stop to breakeven, trail the rest on the 10- or 20-day MA.
          <br><b>Episodic pivot:</b> gap ≥ 10% on ≥ 2× volume on a real catalyst, ideally after months of neglect. Stop = low of the gap day.
          <br><a href="https://qullamaggie.com/how-to-master-a-setup-episodic-pivots/" target="_blank" rel="noopener">qullamaggie.com</a> · <a href="https://deepvue.com/screener/qullamaggie-screens/" target="_blank" rel="noopener">Deepvue screens</a></div>
        <div><b>Mark Minervini: VCP inside the Trend Template.</b> Stage-2 uptrend (8-point template), then 2–4 contractions each ~20%+ smaller than the last (e.g. 22% → 8% → 3%) on drying volume. Buy the pivot on expanding volume. Final contraction ≤ 10%. Stop 6–8% (never > 10%), under the last contraction low. Aim for ≥ 3:1.
          <br><a href="https://traderlion.com/technical-analysis/volatility-contraction-pattern/" target="_blank" rel="noopener">TraderLion: VCP</a> · <a href="https://www.chartmill.com/documentation/stock-screener/fundamental-analysis-investing-strategies/465-Mark-Minervini-Strategy-Think-and-Trade-Like-a-Champion-Trading-Strategy" target="_blank" rel="noopener">ChartMill: Minervini</a></div>
        <div><b>William O'Neil (CANSLIM technicals).</b> RS rating ≥ 80; a sound base ≥ 5 weeks and ≤ ~35% deep after a ≥ 30% prior advance (a handle adds quality). Breakout volume ≥ 40–50% above average. Buy within 5% of the pivot. <b>Cut every loss at 7–8%.</b> Buy only in a confirmed market uptrend ("M"): the regime panel counts distribution days and breadth.
          <br><a href="https://en.wikipedia.org/wiki/CAN_SLIM" target="_blank" rel="noopener">CAN SLIM</a> · <a href="https://www.chartmill.com/documentation/trading-and-investing/methodologies/527-William-ONeils-7-8-Sell-Rule-Explained" target="_blank" rel="noopener">The 7–8% rule</a></div>
        <div><b>Stan Weinstein: Stage Analysis.</b> Stages 1–4 from the 30-week MA (≈150 days): buy <b>Stage 2</b> (price above a rising 30-week MA) on a breakout above resistance with <b>≥ 2× volume</b> and <b>Mansfield RS &gt; 0</b> (outperforming the S&amp;P 500). Hold while above the rising MA; avoid Stage 4 (below a falling MA).
          <br><a href="https://traderlion.com/trading-strategies/stage-analysis/" target="_blank" rel="noopener">TraderLion: Stage Analysis</a> · <a href="https://www.stageanalysis.net/blog/4266/how-to-create-the-mansfield-relative-performance-indicator" target="_blank" rel="noopener">Mansfield RS</a></div>
      </div>
      <p class="help" style="margin-top:10px"><b>Option structure per setup:</b> the IV regime picks buy vs sell premium. When IV is cheap or fair: ~70Δ calls or a call debit spread with the short strike at the 2R target. When IV is rich: a bull put spread with the short strike <i>below the setup's stop</i>, so it only loses if the setup fails. Avoid holding short premium through earnings unless that's the trade (Earnings tab).</p>
    </section>
    <div id="cards" class="ideas-grid">${loading()}</div>
    <section class="card" style="margin-top:16px">
      <div class="card-h"><h2>Risk management rules of thumb</h2></div>
      <ul class="help" style="padding-left:18px;display:grid;gap:6px;margin:0">
        <li>Risk 1–2% of the account per defined-risk trade; keep any single position under ~10% of capital (set in Settings — the engine sizes contracts for you).</li>
        <li>Trade small and often: many independent, high-probability occurrences let the probabilities work.</li>
        <li>Mechanical exits beat hope: 50% profit on credit trades, 21 DTE management, 2× credit stop; debit trades exit on the chart stop.</li>
        <li>Mind earnings: IV crush helps short premium after the event but gap risk is real. Check dates before entering.</li>
        <li>Check liquidity: tight markets (&lt; ~10% of mid), open interest in the hundreds or more, and prefer monthly expirations on thinner names.</li>
      </ul>
    </section>`;
  try {
    const pb = await api.get('playbook');
    root.querySelector('#cards').innerHTML = Object.values(pb).map(s => `<article class="idea">
      <div class="top"><div class="title"><b>${esc(s.label)}</b></div>${biasPill(s.bias)}<span class="pill ${s.kind === 'credit' ? 'good' : 'info'}">${s.kind}</span></div>
      <ul>${s.rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
      <div class="help"><b>Manage:</b> ${esc(s.manage)}</div></article>`).join('');
  } catch (e) { root.querySelector('#cards').innerHTML = errorBox(e); }
}
