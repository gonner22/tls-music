import { Injectable } from '@angular/core';
import { TelestaiBlock } from '../models/telestai-block';

@Injectable({ providedIn: 'root' })
export class TelestaiService {
  private rpcUrl = '/telestai/';
  private rpcUser = 'superstrongusername';
  private rpcPassword = 'superstrongpassword';

  private getAuthHeader(): string {
    return 'Basic ' + btoa(`${this.rpcUser}:${this.rpcPassword}`);
  }

  async getBestBlockHash(): Promise<string> {
    const body = {
      jsonrpc: '1.0',
      id: 'tls-music',
      method: 'getbestblockhash',
      params: []
    };
    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.getAuthHeader(),
      },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    return data.result;
  }

  async getBlock(hash: string): Promise<TelestaiBlock> {
    const body = {
      jsonrpc: '1.0',
      id: 'tls-music',
      method: 'getblock',
      params: [hash, true]
    };
    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.getAuthHeader(),
      },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    return data.result;
  }
} 