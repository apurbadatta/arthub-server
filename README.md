# ⚙️ ArtHub – Backend API Server

This is the production-ready Node.js & Express.js backend server for **ArtHub**, configured with a secure RESTful API, dynamic role-based routes, and payment automation architectures.

---

## 🚀 Core Features & Business Logic

- **Role-Based Middlewares (RBAC):** Strict JWT verification separating route access across `User (Buyer)`, `Artist`, and `Admin`.
- **Stripe Escrow Gateway:** Automated checkout triggers configured with database verification checks (e.g., stopping artists from buying their own art).
- **Subscription Tier Limitation Engine:** Backend logic intercepts requests to enforce limits based on user tiers before initiating payments:
  - `Free Tier`: Caps lifetime/active acquisitions to **3 pieces**.
  - `Pro Tier ($9.99)`: Caps active acquisitions to **9 pieces**.
  - `Premium Tier ($19.99)`: Grants **Unlimited** transactional access.
- **Context-Aware Commentary System:** Enforces database receipt checks via `POST /api/artworks/:id/comments` so only verified purchasers can leave reviews.

---

## 🛠️ Built-With (Dependencies & Packages)

The server architecture isolates its workload using the following modular dependencies:

| Package Name | Purpose / Technical Usage |
| :--- | :--- |
| `express` | Robust MVC handling, routing matrices, and server configuration. |
| `mongoose` / `mongodb` | ODM layer for schema orchestration, escrow collections, and transaction history. |
| `jsonwebtoken` (JWT) | Stateless security tokens configured with a strict 7-day expiration lifecycle. |
| `stripe` | Live webhook management and secure external session generation. |
| `cors` | Cross-Origin resource sharing manager supporting explicit secure client credentials. |
| `dotenv` | Total environmental variable abstraction protecting absolute private keys. |
| `bcryptjs` | Multi-round hash salt protection for local password storage. |

---

## 🔐 Environment Architecture Blueprint

To spin up the service locally or in production, configure a `.env` file inside your server root directory containing the following metrics:

```env
PORT=****
CLIENT_URL=****
MONGODB_URI=****
JWT_SECRET=****
STRIPE_SECRET_KEY=****