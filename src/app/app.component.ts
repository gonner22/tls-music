import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { StateService } from './services/state.service.js';
import { SharedModule } from './shared/shared.module.js';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, CommonModule, SharedModule],
  standalone: true,
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  public loading = false;
  public initialized = true;
  public showDonate = false;
  public showLicense = false;
  public telestaiAddress = 'TesBmcgLQsowvYEYPXpSHkkapoTbVV7Xfe';
  public copiedText: boolean = false;
  public year = new Date().getFullYear();

  constructor(public stateService: StateService) {}

  logoClick() {
    window.open('https://telestai.io', '_blank');
  }

  copyToClipboard(text: string) {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    this.copiedText = true;
    setTimeout(() => {
      this.copiedText = false;
    }, 2000);
  }
}
