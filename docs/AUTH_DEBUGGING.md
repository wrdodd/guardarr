# Guardarr Authentication Debugging Guide

## Common Issues

### 1. "Invalid Plex token" Error

If you're getting this error with a valid Plex token, check:

1. **NEXTAUTH_SECRET is set** - This is required in production. Generate one with:
   ```bash
   openssl rand -base64 32
   ```

2. **Check the auth debug log** - The auth route now writes to `/app/data/auth-debug.log`:
   ```bash
   docker exec guardarr cat /app/data/auth-debug.log
   ```

3. **Verify the token format** - Plex tokens typically look like:
   - `TU-xxxxxxxxxxxxxxxxxxxx` (Tunables/Claim tokens)
   - Or longer alphanumeric strings

### 2. No Debug Logs Appearing

The auth route now writes debug info to a file. Check:
- Container logs: `docker logs guardarr`
- Auth debug file: `docker exec guardarr cat /app/data/auth-debug.log`

### 3. Plex API Response Issues

The Plex `/api/v2/user` endpoint can return either JSON or XML. The updated auth route handles both formats.

## Testing Authentication

Test your token manually:

```bash
# JSON response
curl -H "Accept: application/json" \
     -H "X-Plex-Token: YOUR_TOKEN_HERE" \
     https://plex.tv/api/v2/user

# XML response (fallback)
curl -H "X-Plex-Token: YOUR_TOKEN_HERE" \
     https://plex.tv/api/v2/user
```

## Environment Variables Required

| Variable | Description | Required |
|----------|-------------|----------|
| `NEXTAUTH_SECRET` | Random string for JWT encryption | Yes |
| `NEXTAUTH_URL` | Your app URL (e.g., http://localhost:4600) | Yes |
| `PLEX_SERVER_URL` | Your Plex server URL | For full functionality |
| `PLEX_ADMIN_TOKEN` | Admin token for server management | For full functionality |

## Rebuilding After Changes

```bash
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```
