/** Claims this service expects in an access token. */
export interface AccessTokenPayload {
  /** User id (a MongoDB ObjectId hex string). */
  sub: string;
  roles?: string[];
}

/** What `@CurrentUser()` returns, attached to `request.user` by JwtAuthGuard. */
export interface AuthUser {
  id: string;
  roles: string[];
}

export interface AuthenticatedRequest {
  user?: AuthUser;
}
