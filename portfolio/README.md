# Portfolio

One page for your CMC, IBKR and Coinbase holdings, with live prices, a donut chart by asset type or by holding, and totals in AUD, EUR or USD.

## Put it online (GitHub Pages, free)

1. On github.com, click **New repository**, name it `portfolio`, set it to **Public**, and create it.
   (Your positions are not stored in the repository, only in your browser, so public is fine. Private repositories need a paid GitHub plan for Pages.)
2. Click **Add file → Upload files** and drag in `index.html`, `styles.css`, `app.js`, `csv.js` and this README. Click **Commit changes**.
3. Go to **Settings → Pages**. Under *Branch*, pick `main` and `/ (root)`, then **Save**.
4. After a minute your site is at `https://<your-username>.github.io/portfolio/`. Bookmark it, or add it to your phone's home screen.

## Turn on live stock prices (one time)

1. Create a free account at **finnhub.io** and copy your API key from the dashboard.
2. On your site, open **Settings**, paste the key, and press **Save**.

The status dot at the top right turns green ("Live") when prices are streaming.
Crypto prices and exchange rates come from Coinbase's public feed and need no key.

## Bring in your holdings

Click **Import CSV**, pick the account, and choose the file:

| Account  | File to use |
|----------|-------------|
| CMC      | Holdings / portfolio export as CSV. Average prices are read as AUD. |
| IBKR     | Activity Statement saved as CSV, or a Flex Query CSV with open positions. |
| Coinbase | Transaction history CSV. Balances and average cost are worked out from your buys, sells, sends, receives, rewards and converts. |
| Other    | Any CSV with a symbol column and a quantity column. You pick the columns before importing. |

You see a preview before anything is saved. "Replace current positions in this account" swaps that account's positions for the file's; untick it to add to them instead.
You can also add or edit any position by hand with **+ Add position** or the ✎ button, and set each account's cash with **Edit cash**.

## Good to know

- **Where data lives:** in the browser you use. To use it on your phone too, go to **Settings → Export backup** on your computer, then **Restore backup** on the phone. Re-importing CSVs works as well.
- **Which stocks are live:** the free Finnhub plan streams US-listed stocks and ETFs. Shares on other exchanges (for example ASX) use the last price from your import or a manual price you enter. These are marked with a grey or amber dot instead of green.
- **Price dots:** green = live, amber = last known price, grey = manual price.
- **Daily P&L:** for stocks, today's change versus yesterday's close; for crypto, the change over the last 24 hours.
- **Cost in another currency:** if a position's average price is in a different currency from the display currency, it is converted at today's exchange rate.
