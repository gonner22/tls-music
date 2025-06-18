import { Injectable } from '@angular/core';
import { TelestaiBlock } from '../models/telestai-block';

@Injectable({ providedIn: 'root' })
export class TelestaiService {
  /**
   * Fetch the 200 most recent blocks from the cache service (oldest to newest).
   */
  async getRecentBlocks(): Promise<TelestaiBlock[]> {
    const response = await fetch('https://tls-music.telestai.io/blocks');
    if (!response.ok) throw new Error('Failed to fetch blocks from cache service');
    return await response.json();
  }
} 