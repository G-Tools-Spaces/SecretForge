export interface JwtPayload {
  sub: string; // user id
  email: string;
}

export interface AuthedUser {
  id: string;
  email: string;
  name: string | null;
}
