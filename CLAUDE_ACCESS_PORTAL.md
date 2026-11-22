# Claude access portal

## Goal

Give each teammate or approved client a way to regain access after a team-wide sign-out without asking someone to forward a code. Each person has a named portal account. The reset interval is a configuration choice between every 3 days and every 7 days.

## Original proposal

1. Use one Claude Max account and sign out all active Claude sessions at the end of each cycle.
2. Have each person sign in to the portal with an assigned username and their own password. Use their name as the display label and a unique user ID to track access.
3. When the user requests a code, the proposed portal would display the code from the specific Claude sign-in email redirected to the site.
4. Count one successful sign-in per person per cycle. Requesting or viewing a code leaves the attempt pending. An expired code or an unfinished sign-in leaves the person eligible to retry. The next cycle restores eligibility.

Anthropic's Consumer Terms prohibit sharing account access or credentials. Claude documents a manual sign-out across devices, and its public sign-in guide describes an email link that can produce a verification code. The guide doesn't describe a completion signal for an external portal. Showing a code would therefore leave the portal unable to verify when the teammate finished signing in. [Consumer Terms](https://www.anthropic.com/legal/consumer-terms) · [Sign out of all sessions](https://support.claude.com/en/articles/10310342-how-do-i-log-out-of-all-active-sessions) · [Claude sign-in guide](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account)

## Supported approaches

- **Native Claude access.** Give each teammate their own Claude Team or Enterprise seat. Review the plan's session controls if the reset must sign people out of the native Claude apps. Anthropic documents member sign-out controls, including an Enterprise Admin API in beta. [Team setup](https://support.claude.com/en/articles/9267247-get-started-with-the-team-plan) · [Member session controls](https://support.claude.com/en/articles/13133750-manage-members-on-team-and-enterprise-plans)
- **Vercel portal.** Give each person an individual portal account and use a server-side Claude API service account for model access. The portal issues and verifies its own codes, controls its own sessions, and can reliably enforce the reset. This approach provides Claude model access inside the portal. [Claude API keys](https://platform.claude.com/docs/en/get-api-key)

## Vercel portal MVP

1. An admin creates a named account for each approved person and can disable it immediately. The portal uses managed authentication for individual credentials and sends its own short-lived verification code to that person's registered email when requested.
2. Track the current attempt as **eligible**, **pending**, or **complete**. A code request moves the user to pending. An expired or invalid code allows a retry with rate limits. After verification succeeds, create the portal session and record completion in the same transaction. Keep completion unique to the user and cycle, and block further code requests until the next cycle.
3. Set one shared cycle start and choose a 3-day or 7-day duration. Every protected request checks that its session belongs to the current cycle and that the user's account is active. At the next boundary, require everyone to sign in again. Computing the current cycle on each request lets the reset take effect without a scheduled job.
4. Use Vercel Functions and a small managed Postgres database for account IDs and roles, cycle settings, active sessions, and verification status. Let the authentication provider handle passwords and verification secrets. Keep the Claude API key server-side in Vercel environment variables. [Vercel Functions](https://vercel.com/docs/functions) · [Vercel Marketplace storage](https://vercel.com/docs/marketplace-storage)

## Open decisions

- Choose a 3-day or 7-day cycle and its first reset time in Asia/Karachi.
- Confirm whether users need the native Claude apps or only Claude model access in the portal.
- Decide how users recover access if they lose their portal session after completing verification for the current cycle.
