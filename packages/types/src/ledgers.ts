export interface LedgerDto {
  id: number;
  partyName: string;
  realName?: string | null;
  groupName?: string | null;
  agentId?: number | null;
  distributorId?: number | null;
  telegram?: string | null;
  mobile?: string | null;
  daraRate: number;
  akharRate: number;
  commissionRate: number;
  hissaPercentage: number;
  betLimit: number;
  capping: number;
  isLocked: boolean;
  isRisky: boolean;
  currentBalance?: number;
  createdAt: string;
}

export interface AgentDto {
  id: number;
  userId: number;
  agentName: string;
  parentAgentId?: number | null;
  commissionRate: number;
  hissaPercentage: number;
  contactNumber?: string | null;
}
