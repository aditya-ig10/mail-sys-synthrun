window.SYNTHRUN_EMAIL_TEMPLATES = {
  blank: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>
  body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 0; }
  .container { max-width: 600px; margin: 24px auto; background: #fff; padding: 32px; }
</style></head>
<body>
<div class="container">
  <p>Your content here...</p>
</div>
</body>
</html>`,

  announce: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>
  body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 0; }
  .wrap { max-width: 600px; margin: 24px auto; background: #fff; }
  .hero { background: #111; color: #fff; padding: 40px 32px; text-align: center; }
  .hero h1 { margin: 0 0 8px; font-size: 26px; letter-spacing: -0.02em; }
  .hero p { margin: 0; color: #aaa; font-size: 14px; }
  .body { padding: 32px; color: #333; font-size: 15px; line-height: 1.7; }
  .cta { display: inline-block; margin-top: 20px; background: #111; color: #fff; padding: 12px 24px; text-decoration: none; font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; }
  .footer { padding: 20px 32px; border-top: 1px solid #eee; color: #999; font-size: 11px; }
</style></head>
<body>
<div class="wrap">
  <div class="hero">
    <h1>Announcing [Feature Name]</h1>
    <p>Something exciting is live today</p>
  </div>
  <div class="body">
    <p>Hi there,</p>
    <p>We are thrilled to announce [your announcement here]. This has been in the works for a while and we are excited to share it with you.</p>
    <p>[Add more detail about what changed, why it matters, and what users should do next.]</p>
    <a href="#" class="cta">Learn more &rarr;</a>
  </div>
  <div class="footer">&copy; 2026 Synthrun &middot; <a href="#">Unsubscribe</a></div>
</div>
</body>
</html>`,

  newsletter: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>
  body { font-family: Georgia, serif; background: #fafaf8; margin: 0; padding: 0; }
  .wrap { max-width: 600px; margin: 24px auto; background: #fff; border: 1px solid #e0e0d8; }
  .header { padding: 28px 32px; border-bottom: 1px solid #e0e0d8; display: flex; justify-content: space-between; align-items: center; }
  .logo { font-family: Arial, sans-serif; font-size: 13px; letter-spacing: 0.12em; text-transform: uppercase; }
  .issue { font-family: Arial, sans-serif; font-size: 11px; color: #999; }
  .headline { padding: 32px 32px 20px; border-bottom: 1px solid #e0e0d8; }
  .headline h2 { margin: 0 0 10px; font-size: 22px; line-height: 1.25; }
  .headline p { margin: 0; color: #666; font-size: 15px; line-height: 1.65; }
  .section { padding: 24px 32px; border-bottom: 1px solid #e0e0d8; }
  .section h3 { font-family: Arial, sans-serif; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #999; margin: 0 0 12px; }
  .section p { margin: 0; font-size: 15px; line-height: 1.7; color: #333; }
  .footer { padding: 20px 32px; font-family: Arial, sans-serif; font-size: 11px; color: #aaa; }
</style></head>
<body>
<div class="wrap">
  <div class="header">
    <span class="logo">Synthrun Weekly</span>
    <span class="issue">Issue #42 &middot; May 2026</span>
  </div>
  <div class="headline">
    <h2>Your newsletter headline goes here</h2>
    <p>A short intro paragraph setting the tone for this edition.</p>
  </div>
  <div class="section">
    <h3>Section One</h3>
    <p>First story or topic body text. Keep it short and punchy - readers skim newsletters.</p>
  </div>
  <div class="section">
    <h3>Section Two</h3>
    <p>Second story or topic body text.</p>
  </div>
  <div class="footer">&copy; 2026 Synthrun &middot; <a href="#">Unsubscribe</a> &middot; <a href="#">View in browser</a></div>
</div>
</body>
</html>`,

  promo: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>
  body { font-family: Arial, sans-serif; background: #f0f0ea; margin: 0; padding: 0; }
  .wrap { max-width: 600px; margin: 24px auto; background: #fff; }
  .banner { background: #111; padding: 48px 32px; text-align: center; color: #fff; }
  .banner .eyebrow { font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase; color: #777; margin-bottom: 12px; }
  .banner h1 { font-size: 38px; margin: 0 0 8px; letter-spacing: -0.03em; }
  .banner .sub { font-size: 16px; color: #bbb; }
  .offer { padding: 36px 32px; text-align: center; }
  .badge { display: inline-block; background: #f0f0ea; border: 1px solid #ddd; padding: 8px 18px; font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 24px; }
  .offer p { color: #555; font-size: 15px; line-height: 1.7; margin: 0 0 24px; }
  .cta { display: inline-block; background: #111; color: #fff; padding: 14px 32px; text-decoration: none; font-size: 13px; letter-spacing: 0.1em; text-transform: uppercase; }
  .fine { padding: 16px 32px 28px; text-align: center; font-size: 11px; color: #aaa; }
</style></head>
<body>
<div class="wrap">
  <div class="banner">
    <div class="eyebrow">Limited time</div>
    <h1>30% Off</h1>
    <div class="sub">Everything in our store</div>
  </div>
  <div class="offer">
    <div class="badge">Use code: SAVE30</div>
    <p>For a limited time, take 30% off your entire order. No minimums, no exceptions. Offer ends Sunday at midnight.</p>
    <a href="#" class="cta">Shop now &rarr;</a>
  </div>
  <div class="fine">Valid until May 31, 2026. Cannot be combined with other offers. &middot; <a href="#">Unsubscribe</a></div>
</div>
</body>
</html>`,

  transact: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>
  body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 0; }
  .wrap { max-width: 560px; margin: 24px auto; background: #fff; border: 1px solid #e0e0d8; }
  .header { padding: 24px 28px; border-bottom: 1px solid #eee; }
  .header .logo { font-size: 13px; letter-spacing: 0.12em; text-transform: uppercase; }
  .body { padding: 28px; }
  .body h2 { font-size: 20px; margin: 0 0 16px; }
  .body p { font-size: 14px; color: #555; line-height: 1.7; margin: 0 0 16px; }
  .order-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .order-table th { text-align: left; border-bottom: 1px solid #eee; padding: 8px 0; color: #999; font-weight: normal; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; }
  .order-table td { padding: 10px 0; border-bottom: 1px solid #f4f4f4; color: #333; }
  .total { border-top: 1px solid #eee; margin-top: 12px; padding-top: 12px; display: flex; justify-content: space-between; font-weight: bold; font-size: 15px; }
  .cta { display: inline-block; margin-top: 24px; background: #111; color: #fff; padding: 11px 22px; text-decoration: none; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; }
  .footer { padding: 16px 28px; border-top: 1px solid #eee; font-size: 11px; color: #aaa; }
</style></head>
<body>
<div class="wrap">
  <div class="header"><div class="logo">Synthrun</div></div>
  <div class="body">
    <h2>Order confirmed</h2>
    <p>Thanks for your order! Here's a summary of what you purchased.</p>
    <table class="order-table">
      <thead><tr><th>Item</th><th>Qty</th><th>Price</th></tr></thead>
      <tbody>
        <tr><td>Product Name</td><td>1</td><td>$49.00</td></tr>
        <tr><td>Another Item</td><td>2</td><td>$18.00</td></tr>
      </tbody>
    </table>
    <div class="total"><span>Total</span><span>$67.00</span></div>
    <a href="#" class="cta">View order &rarr;</a>
  </div>
  <div class="footer">Order #SR-10042 &middot; Questions? <a href="mailto:hello@synthrun.site">hello@synthrun.site</a></div>
</div>
</body>
</html>`,

  onboard: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>
  body { font-family: Arial, sans-serif; background: #fafaf8; margin: 0; padding: 0; }
  .wrap { max-width: 580px; margin: 24px auto; background: #fff; border: 1px solid #e4e4dc; }
  .top { background: #111; padding: 36px 32px; text-align: center; }
  .top svg { stroke: #fff; fill: none; stroke-width: 1.4; }
  .top h1 { color: #fff; font-size: 24px; margin: 14px 0 6px; }
  .top p { color: #888; font-size: 13px; margin: 0; }
  .body { padding: 32px; }
  .body h2 { font-size: 18px; margin: 0 0 12px; }
  .body p { font-size: 14px; color: #555; line-height: 1.75; margin: 0 0 20px; }
  .steps { margin: 0 0 24px; padding: 0; list-style: none; }
  .steps li { display: flex; gap: 14px; align-items: flex-start; padding: 12px 0; border-bottom: 1px solid #f4f4f0; font-size: 14px; color: #333; }
  .steps li .num { width: 26px; height: 26px; background: #111; color: #fff; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; flex-shrink: 0; }
  .cta { display: inline-block; background: #111; color: #fff; padding: 13px 28px; text-decoration: none; font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; }
  .footer { padding: 18px 32px; border-top: 1px solid #eee; font-size: 11px; color: #aaa; }
</style></head>
<body>
<div class="wrap">
  <div class="top">
    <svg viewBox="0 0 48 48" width="48" height="48"><circle cx="24" cy="24" r="18"></circle><path d="M16 28c2.5-4.5 5.5-7 8-7s5.5 2.5 8 7"></path></svg>
    <h1>Welcome aboard!</h1>
    <p>You're all set. Here's how to get started.</p>
  </div>
  <div class="body">
    <h2>Three steps to hit the ground running</h2>
    <ol class="steps">
      <li><div class="num">1</div><div><strong>Set up your profile</strong> - Add your name, photo and preferences so teammates recognize you.</div></li>
      <li><div class="num">2</div><div><strong>Explore the dashboard</strong> - Familiarise yourself with the main features and navigation.</div></li>
      <li><div class="num">3</div><div><strong>Invite your team</strong> - Things are more fun (and more productive) together.</div></li>
    </ol>
    <a href="#" class="cta">Open your dashboard &rarr;</a>
  </div>
  <div class="footer">&copy; 2026 Synthrun &middot; <a href="#">Unsubscribe</a> &middot; <a href="#">Privacy policy</a></div>
</div>
</body>
</html>`
};
