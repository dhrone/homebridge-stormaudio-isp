/**
 * Logger implementation for the hardware test harness.
 * Captures all messages for the protocol log and prints to console.
 */

export class HarnessLogger {
  readonly messages: string[] = [];

  info(message: string, ...params: unknown[]): void {
    const formatted = this.format('INFO', message, params);
    this.messages.push(formatted);
    console.log(formatted);
  }

  warn(message: string, ...params: unknown[]): void {
    const formatted = this.format('WARN', message, params);
    this.messages.push(formatted);
    console.warn(formatted);
  }

  error(message: string, ...params: unknown[]): void {
    const formatted = this.format('ERROR', message, params);
    this.messages.push(formatted);
    console.error(formatted);
  }

  debug(message: string, ...params: unknown[]): void {
    const formatted = this.format('DEBUG', message, params);
    this.messages.push(formatted);
    // Print debug messages too — we want full protocol visibility
    console.log(formatted);
  }

  private format(level: string, message: string, params: unknown[]): string {
    const ts = new Date().toISOString();
    const suffix = params.length > 0 ? ' ' + params.map(String).join(' ') : '';
    return `[${ts}] [${level}] ${message}${suffix}`;
  }
}
