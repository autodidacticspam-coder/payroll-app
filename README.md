# Payroll Calculator

A web-based payroll calculator with overtime tracking.

## Features
- Track clock in/out times (2 shifts per day)
- Automatic overtime calculation (daily >9hrs OR weekly >40hrs)
- Uses whichever overtime method benefits the employee more
- Save and load previous weeks
- Print timesheets
- Auto-saves as you type

## Local Development

1. Install Node.js (version 18 or higher)
2. Open terminal in this folder
3. Run: `npm install`
4. Run: `npm start`
5. Open: http://localhost:3000

## Deploy to Railway (Recommended - Free)

1. Create account at https://railway.app
2. Install Railway CLI or use web dashboard
3. Create new project from GitHub repo
4. Railway will auto-detect Node.js and deploy
5. Your app will be live at a URL like: yourapp.up.railway.app

### Quick Deploy via GitHub:
1. Push this folder to a GitHub repository
2. Go to railway.app and click "New Project"
3. Select "Deploy from GitHub repo"
4. Select your repo
5. Done! Railway handles everything

## Deploy to Render (Alternative - Free)

1. Create account at https://render.com
2. New > Web Service
3. Connect your GitHub repo
4. Settings:
   - Build Command: `npm install`
   - Start Command: `npm start`
5. Deploy

## Deploy to Vercel (Alternative)

Note: Vercel works best with serverless, so SQLite won't persist.
For Vercel, you'd need to switch to a cloud database like PlanetScale or Supabase.

## Environment Variables

None required for basic setup. The app uses SQLite which stores data in `payroll.db`.

## Sharing with Others

Once deployed, just share the URL (e.g., `https://yourapp.up.railway.app`) with anyone who needs access. All users will share the same database.
