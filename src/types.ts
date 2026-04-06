export interface Bidding {
  id: string;
  title: string;
  object: string;
  biddingNumber: string;
  processNumber: string;
  portal: string;
  link: string;
  date?: string;
  type: 'public' | 'private';
  entityType?: 'municipal' | 'state' | 'federal' | 'private';
  biddingType?: string;
  estimatedValue?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
}

export interface SearchFilters {
  query: string;
  type: 'all' | 'public' | 'private';
  entityType?: 'all' | 'municipal' | 'state' | 'federal' | 'private';
  state?: string;
  biddingType?: string;
  minDate?: string;
  maxDate?: string;
  minValue?: string;
  maxValue?: string;
}

export type BiddingStatus = 'Acompanhando' | 'Análise' | 'Finalizada';

export interface SavedBidding extends Bidding {
  userId: string;
  savedAt: number;
  status: BiddingStatus;
}

export interface SearchAlert {
  id: string;
  userId: string;
  name: string;
  filters: SearchFilters;
  createdAt: number;
  lastCheckedAt?: number;
}

export interface SearchHistory {
  id: string;
  userId: string;
  query: string;
  filters: SearchFilters;
  timestamp: number;
}

export interface SavedFilter {
  id: string;
  userId: string;
  name: string;
  filters: SearchFilters;
  createdAt: number;
}
