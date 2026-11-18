# Deploying Reclaim Value (free)

The online version runs the website and API as **one free Render web service**, with data in a **free MongoDB Atlas** cluster.

The Python AI service (YOLO models) is **not** deployed, because it needs 1–2 GB of memory and free hosts give about 512 MB. Online:

- The Capture page says "Photo recognition isn't available in this online version", and the user picks the material by hand.
- Price estimates, salvage recommendations and natural-language search use the backend's built-in rules.
- Everything else works as it does locally: marketplace, requests, Wanted alerts and notifications, impact dashboard and admin.

To show the trained model, run the app locally (see README).

Free-tier behaviour to know:

- **The site sleeps after 15 minutes without visitors.** The next visit takes about a minute to wake it.
- **Render's disk is wiped when the site sleeps or redeploys,** so uploaded photos disappear. To keep them, add a free Cloudinary account (step 5).

## 1. Database: MongoDB Atlas (free M0)

1. Sign up at <https://www.mongodb.com/cloud/atlas/register>.
2. Create a cluster: choose **M0 / Free** and a region near you (e.g. Mumbai).
3. Create the database user:
   - Go to **Database Access → Add new database user**.
   - Use password authentication and click **Autogenerate** for the password.
   - Copy the password and keep it safe.
4. Allow Render to connect: **Network Access → Add IP address → Allow access from anywhere** (`0.0.0.0/0`). Render's free plan has no fixed IP address.
5. Get the connection string:
   - Go to **Clusters → Connect → Drivers** and copy the string.
   - Replace `<db_password>` with the password.
   - Add the database name before the `?`: `...mongodb.net/reclaim_value?retryWrites=true...`
6. Optional: load the demo accounts and sample listings from your computer:

   ```bash
   cd backend
   MONGO_URI="paste-the-connection-string" npm run seed:demo
   ```

## 2. Code on GitHub

```bash
brew install gh            # once
gh auth login              # GitHub.com → HTTPS → Login with a web browser
cd reclaim-value
git init
git add .
git ls-files | grep -E '(^|/)\.env$|\.pt$'   # must print nothing
git commit -m "Reclaim Value"
gh repo create reclaim-value --private --source=. --push
```

`.gitignore` already excludes `.env`, model weights, `node_modules`, uploads and training data.

## 3. Website and API: Render (free web service)

1. Sign up at <https://render.com> with GitHub.
2. Choose **New → Web Service** and pick the `reclaim-value` repository.
3. Fill in the settings:

   | Setting | Value |
   |---|---|
   | Language | Node |
   | Root Directory | *(empty)* |
   | Build Command | `cd frontend && npm ci --include=dev && npm run build && cd ../backend && npm ci --omit=dev` |
   | Start Command | `cd backend && npm start` |
   | Instance Type | Free |

4. Add these environment variables:

   | Key | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `NODE_VERSION` | `22` |
   | `MONGO_URI` | the Atlas connection string from step 1 |
   | `JWT_SECRET` | a long random string (Render's **Generate** button) |
   | `AI_SERVICE_URL` | `off` |

5. Under **Advanced**, set **Health Check Path** to `/api/health`.
6. Choose **Deploy**. The first build takes about 5 minutes. The site is then live at `https://<name>.onrender.com`.

The Express server serves the built website from `frontend/dist`, so there is one URL and CORS does not need setting up.

## 4. Updating

Push to GitHub and Render redeploys automatically:

```bash
git add . && git commit -m "Update" && git push
```

## 5. Optional extras

- **Keep uploaded photos:** create a free Cloudinary account. Add `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` to the Render environment variables.
- **Gemini for general assistant questions:** add `GEMINI_API_KEY` (and `GEMINI_MODEL`).
- **Admin account:** register normally, then in Atlas open **Browse Collections → users** and set your user's `role` to `Admin`.
