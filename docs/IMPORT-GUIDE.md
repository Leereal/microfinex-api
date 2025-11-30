# How to Import the Microfinex API Collection

## 📥 Import Instructions

### Method 1: Import from File

1. Open Postman
2. Click **Import** button (top left)
3. Click **Upload Files**
4. Select `docs/Microfinex-API-v1-Smart-Collection.postman_collection.json`
5. Click **Import**

### Method 2: Drag & Drop

1. Open Postman
2. Open your file explorer
3. Navigate to `docs/Microfinex-API-v1-Smart-Collection.postman_collection.json`
4. Drag the file into Postman
5. The collection will be imported automatically

## ⚡ Quick Test

After importing:

1. **Find the Collection**: Look for "Microfinex API v1 - Smart Collection" in your sidebar
2. **Expand Authentication Folder**: Click on "🔐 Authentication"
3. **Run Login Request**: Click on "Login" → Send
4. **Check Console**: Open Postman Console (View → Show Postman Console)
5. **Verify Success**: You should see:
   ```
   🔐 ✅ Auth token automatically updated!
   🎉 LOGIN SUCCESSFUL!
   ✨ All subsequent requests will now use the auth token automatically.
   ```

## 🎯 First Steps After Import

1. **Verify Base URL**: Check that `baseUrl` variable is set to `http://localhost:8000/api/v1`
2. **Test Health Check**: Run "API Health Check" (no auth needed)
3. **Login**: Run "Login" to populate auth token
4. **Try Protected Endpoint**: Run "List Organizations" or "List Clients"

## 📋 Collection Variables

After import, these variables will be available:

- `baseUrl` - API base URL (preset)
- `authToken` - JWT token (auto-populated from login)
- `userId` - Current user ID (auto-populated)
- `organizationId` - Organization ID (auto-populated)
- And more...

## 🔍 Verifying Import Success

**Check 1**: Collection appears in sidebar with emoji icons  
**Check 2**: Variables tab shows baseUrl = `http://localhost:8000/api/v1`  
**Check 3**: Authentication folder contains 4 requests  
**Check 4**: Collection-level auth is set to Bearer Token with `{{authToken}}`

## 🆘 Troubleshooting Import

### Collection Not Showing

- **Solution**: Refresh Postman or restart the application

### Requests Failing with 404

- **Solution**: Check baseUrl variable matches your API server

### No Auto-Population Working

- **Solution**: Ensure you imported the correct file from `docs/` folder

### Variables Not Visible

- **Solution**: Click collection name → Variables tab to see all variables

## 🎉 You're Ready!

Once imported successfully, you can start testing the API immediately with full automation:

- Login once, use everywhere
- Automatic ID population
- Smart error handling
- Comprehensive logging

For detailed usage instructions, see `README-Postman-Collection.md`.
