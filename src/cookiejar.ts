/** 极简 cookie 罐：够用即可，只处理 名=值 对。 */
export class CookieJar {
  private jar = new Map<string, string>();

  /** 从 fetch 响应的 set-cookie 头列表吸收 cookie */
  absorb(setCookies: string[] | undefined): void {
    if (!setCookies) return;
    for (const line of setCookies) {
      const pair = line.split(';')[0];
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === 'deleted' || value === '') {
        this.jar.delete(name);
      } else {
        this.jar.set(name, value);
      }
    }
  }

  set(name: string, value: string): void {
    this.jar.set(name, value);
  }

  get(name: string): string | undefined {
    return this.jar.get(name);
  }

  header(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  clear(): void {
    this.jar.clear();
  }
}
