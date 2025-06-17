import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'timeAgo', standalone: true })
export class TimeAgoPipe implements PipeTransform {
  transform(value: number | Date | string): string {
    if (!value) return '';
    let date: Date;
    if (typeof value === 'number') {
      date = new Date(value);
    } else if (typeof value === 'string') {
      date = new Date(Number(value));
    } else {
      date = value;
    }
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      return `${mins} min${mins > 1 ? 's' : ''} ago`;
    }
    if (seconds < 86400) {
      const hours = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      let result = `${hours}h`;
      if (mins > 0) result += ` ${mins} min${mins > 1 ? 's' : ''}`;
      return result + ' ago';
    }
    if (seconds < 2592000) {
      const days = Math.floor(seconds / 86400);
      return `${days} day${days > 1 ? 's' : ''} ago`;
    }
    if (seconds < 31536000) {
      const months = Math.floor(seconds / 2592000);
      return `${months} month${months > 1 ? 's' : ''} ago`;
    }
    const years = Math.floor(seconds / 31536000);
    return `${years} year${years > 1 ? 's' : ''} ago`;
  }
} 