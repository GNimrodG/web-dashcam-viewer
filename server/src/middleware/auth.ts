import * as oauth from "openid-client";
import type { Request, Response, NextFunction } from "express";
import { logger } from "../logger.js";

let config: oauth.Configuration | null = null;
let clientId: string | null = null;
let clientSecret: string | null = null;
let redirectUriGlobal: string | null = null;

declare module "express-session" {
  interface SessionData {
    user?: {
      sub: string;
      email?: string;
      name?: string;
      preferred_username?: string;
    };
    codeVerifier?: string;
    state?: string;
    returnUrl?: string;
  }
}

export async function initOIDC(
  issuerUrl: string,
  clientIdParam: string,
  clientSecretParam: string,
  redirectUri: string,
) {
  try {
    logger.info({ issuerUrl }, "Initializing OIDC client");

    const issuer = new URL(issuerUrl);
    config = await oauth.discovery(issuer, clientIdParam, {
      client_secret: clientSecretParam,
      token_endpoint_auth_method: "client_secret_post",
    });
    clientId = clientIdParam;
    clientSecret = clientSecretParam;
    redirectUriGlobal = redirectUri;

    logger.info("OIDC client initialized successfully");
  } catch (error) {
    logger.error({ error }, "Failed to initialize OIDC client");
    throw error;
  }
}

export async function getAuthorizationUrl(req: Request): Promise<string> {
  if (!config || !clientId) throw new Error("OIDC client not initialized");

  const codeVerifier = oauth.randomPKCECodeVerifier();
  const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
  const state = oauth.randomState();

  // Store code verifier and state in session
  req.session.codeVerifier = codeVerifier;
  req.session.state = state;

  const redirectUri = redirectUriGlobal
    ? new URL(redirectUriGlobal)
    : new URL("/api/auth/callback", `${req.protocol}://${req.get("host")}`);
  const metadata = config.serverMetadata();

  if (!metadata.authorization_endpoint) {
    throw new Error("No authorization endpoint found in server metadata");
  }

  const params = new URLSearchParams();
  params.set("client_id", clientId);
  params.set("redirect_uri", redirectUri.href);
  params.set("response_type", "code");
  params.set("scope", "openid email profile");
  params.set("code_challenge", codeChallenge);
  params.set("code_challenge_method", "S256");
  params.set("state", state);

  const authUrl = new URL(metadata.authorization_endpoint);
  authUrl.search = params.toString();

  return authUrl.href;
}

export async function handleCallback(
  req: Request,
  code: string,
): Promise<void> {
  if (!config || !clientId || !clientSecret)
    throw new Error("OIDC client not initialized");

  const codeVerifier = req.session.codeVerifier;
  const state = req.session.state;

  if (!codeVerifier) {
    throw new Error("Code verifier not found in session");
  }

  if (!state) {
    throw new Error("State not found in session");
  }

  // Verify state matches
  const receivedState = req.query.state as string;
  if (receivedState !== state) {
    throw new Error("State mismatch");
  }

  const currentUrl = new URL(
    req.originalUrl || req.url,
    `${req.protocol}://${req.get("host")}`,
  );

  const tokens = await oauth.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: codeVerifier,
    expectedState: state,
  });

  // Process ID token claims
  const idTokenClaims = tokens.claims();

  req.session.user = {
    sub: idTokenClaims!.sub,
    email: idTokenClaims!.email as string | undefined,
    name: idTokenClaims!.name as string | undefined,
    preferred_username: idTokenClaims!.preferred_username as string | undefined,
  };

  delete req.session.codeVerifier;
  delete req.session.state;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  // Just passes through - auth is optional
  next();
}

export function logout(req: Request, res: Response) {
  req.session.destroy((err) => {
    if (err) {
      logger.error({ error: err }, "Error destroying session");
      return res.status(500).json({ error: "Failed to logout" });
    }
    res.json({ success: true });
  });
}

export function getCurrentUser(req: Request) {
  return req.session.user || null;
}
