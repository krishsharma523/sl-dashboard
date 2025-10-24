# SL Forecast Dashboard (XGBoost, Buyer-Focused, 1/3/6M)

- Single model: **XGBoost**
- Endpoints:
  - `/api/current?commodity=Rice`
  - `/api/history?commodity=Rice&months=60`
  - `/api/buyer-forecast?commodity=Rice&h=1` (h in months)
  - `/api/horizons?commodity=Rice&horizons=1,3,6`

## Run

### Backend
```powershell
cd backend
py -3.11 -m venv .venv
.\.venv\Scriptsctivate
pip install -r requirements.txt
python app.py
```

### Frontend
```powershell
cd ../frontend
npm install
npm run dev
```
Open http://localhost:5173
