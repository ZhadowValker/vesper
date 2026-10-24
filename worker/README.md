# NVIDIA proxy for Vesper (Cloudflare Worker)

Why: NVIDIA's API refuses calls made straight from a web page. This small Worker sits in between and keeps your NVIDIA key off the phone.

## Set up (about 5 minutes, free)
1. Make a free account at dash.cloudflare.com, then **Workers & Pages > Create > Create Worker**. Name it `vesper-ai`, press Deploy.
2. Press **Edit code**, replace everything with the contents of `nvidia-proxy.js`, press **Deploy**.
3. Open the Worker's **Settings > Variables and Secrets** and add two **Secrets**:
   - `NVIDIA_API_KEY`: a new key from build.nvidia.com
   - `APP_TOKEN`: any long random text (for example 30 random letters and numbers)
4. Copy the Worker address, like `https://vesper-ai.YOURNAME.workers.dev`.
5. In Vesper, tap **AI**:
   - Address: `https://vesper-ai.YOURNAME.workers.dev/v1`
   - Key: the same text you used for `APP_TOKEN`
   - Press **Test connection**.

The Worker only answers requests from `zhadowvalker.github.io`, only for chat completions, and only with your token. To rotate access, change `APP_TOKEN` in Cloudflare and in the app.
