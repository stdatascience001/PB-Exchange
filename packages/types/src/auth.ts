export type SystemRole =
  | 'DEVELOPER'
  | 'SUPER ADMIN'
  | 'DISTRIBUTOR'
  | 'RETAILER'
  | 'FANTER'
  | 'CASH AGENT'
  | 'ADMIN'
  | 'MANAGER'
  | 'MARKETER'
  | 'AUDITOR'
  | 'DATA ENTRY OPERATOR'
  | 'TALLY OPERATOR';

export interface UserSession {
  userId: number;
  username: string;
  roleId: number;
  roleName: SystemRole;
}

export interface LoginResponse {
  user: UserSession;
  token: string;
}

export interface CaptchaData {
  id: string;
  question: string;
}
