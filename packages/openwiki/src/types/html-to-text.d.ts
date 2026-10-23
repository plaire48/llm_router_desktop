declare module "html-to-text" {
  export function htmlToText(
    html: string,
    options?: {
      wordwrap?: number | false;
      limits?: { maxInputLength?: number };
      selectors?: { selector: string; format: string }[];
    },
  ): string;
}
