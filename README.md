# CubeBoxTimer – Rubik’s Cube Timer & Statistics App

CubeBoxTimer is a modern Rubik’s Cube timer and statistics web app built with React and Firebase. It supports session management, advanced statistics, beautiful charts, and persistent user history.

## Features

- **WCA-style Timer**: Spacebar or click to start/stop, with visual countdown.
- **15s inspection & Penalties** — Visual/logic countdown before timing starts, applies +2/DNF to solve times as per WCA rules
- **Session Management**: Create, switch, and delete sessions. Each session tracks its own solves.
- **Advanced Statistics**: See best, worst, mean, ao5, ao12, and total solves for both the current session and all-time.
- **Beautiful Charts**: Visualize your progress with interactive charts (Chart.js).
- **Persistent User History**: All sessions and solves are stored in Firebase Firestore (or local fallback if not logged in).
- **Authentication**: Google login for syncing your solves across devices.
- **Responsive UI**: Works great on desktop and mobile.

## Getting Started

### 1. Clone the repository
```sh
git clone https://github.com/ameyg24/cubeboxtimer
```

### 2. Install dependencies
```sh
npm install
```

### 3. Set up environment variables
Copy `.env.example` to `.env` and fill in your Firebase project credentials:
```sh
cp .env.example .env
```
Edit `.env` and set the values from your Firebase console.

### 4. Start the development server
```sh
npm run dev
```

The app will be available at [http://localhost:5173](http://localhost:5173) (or the port shown in your terminal).

## Project Structure

- `src/` – Main source code
  - `components/` – React components (Timer, Dashboard, Sidebar, etc.)
  - `firebase/` – Firebase config
  - `App.jsx` – Main app logic
  - `App.css` – Main styles
- `.env.example` – Example environment variables (do not commit your real `.env`)

## Environment Variables
See `.env.example` for required variables:
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

## License
MIT

---

Made with ❤️ for cubers.
