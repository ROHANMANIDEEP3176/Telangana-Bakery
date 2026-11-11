# Telangana Bakery – online ordering with cash / UPI on delivery

Customer site: `/`  ·  Owner dashboard: `/admin.html`
Customers order on the website and choose **Cash on delivery** or **UPI on delivery**, then track the order live.
The owner updates the status; when an order is marked **Delivered**, it is recorded as paid.

## Deploy on Vercel (with a free Neon database)
1. **Neon:** sign up at neon.com (free, no card) → New project → copy the **pooled connection string** (starts with `postgresql://`). Tables are created automatically.
2. **GitHub:** create a *private* repository and upload everything in this folder (not `node_modules`).
3. **Vercel:** vercel.com → Add New → Project → import the GitHub repo. Leave the build settings as they are.
4. Before deploying, open **Environment Variables** and add `DATABASE_URL` (the Neon string) and `ADMIN_PASSWORD` (your own strong password). Deploy.
5. Open your `https://….vercel.app` link, then `/admin.html`, log in, upload photos and press **Save menu**.
6. Own domain: Vercel → Project → Settings → Domains.

**Important:** Vercel's free Hobby plan is for personal, non-commercial use only. A bakery taking orders is a business, so use Vercel Pro (check vercel.com/pricing) or another host.

## Using the dashboard
- **Orders:** Confirmed → Preparing → Out for delivery → Delivered (customers see this live).
- **Photos:** choose a photo per menu item (auto-resized), then **Save menu**.
- **Optional UPI QR at checkout:** enter your UPI ID in the dashboard to add a "Pay by UPI QR" option; confirm each one with **Payment received ✓** after checking your UPI app. Leave empty to hide it.

## Run on your own computer
`npm install` then `npm start` (no DATABASE_URL = saves to local files) → http://localhost:3000
