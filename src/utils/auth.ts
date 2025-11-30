import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { JWTPayload } from '../types';

const SALT_ROUNDS = 12;

/**
 * Hash a password using bcrypt
 */
export const hashPassword = async (password: string): Promise<string> => {
  return bcrypt.hash(password, SALT_ROUNDS);
};

/**
 * Compare a password with its hash
 */
export const comparePassword = async (
  password: string,
  hash: string
): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};

/**
 * Generate a JWT token
 */
export const generateToken = (payload: JWTPayload): string => {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  } as jwt.SignOptions);
};

/**
 * Verify a JWT token
 */
export const verifyToken = (token: string): JWTPayload => {
  return jwt.verify(token, config.jwt.secret, {
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  }) as JWTPayload;
};

/**
 * Generate a refresh token
 */
export const generateRefreshToken = (payload: JWTPayload): string => {
  return jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn,
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  } as jwt.SignOptions);
};

/**
 * Verify a refresh token
 */
export const verifyRefreshToken = (token: string): JWTPayload => {
  return jwt.verify(token, config.jwt.refreshSecret, {
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  }) as JWTPayload;
};
