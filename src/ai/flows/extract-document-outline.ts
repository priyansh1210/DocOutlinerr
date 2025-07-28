
'use server';

/**
 * @fileOverview This flow uses a Genkit AI model to extract a structured outline from a PDF document.
 * It identifies the main title and hierarchical headings (H1, H2, etc.) based on the document's content and layout.
 *
 * - extractDocumentOutline: An async function that takes a PDF data URI and returns a structured outline.
 * - ExtractDocumentOutlineInput: The Zod schema for the input object.
 * - ExtractDocumentOutlineOutput: The Zod schema for the output object.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const ExtractDocumentOutlineInputSchema = z.object({
  pdfDataUri: z
    .string()
    .describe(
      "A PDF document, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type ExtractDocumentOutlineInput = z.infer<typeof ExtractDocumentOutlineInputSchema>;

const ExtractDocumentOutlineOutputSchema = z.object({
  title: z.string().describe('The main title of the document. This should be the most prominent title, often found on the first page.'),
  outline: z.array(
    z.object({
      level: z.string().describe('The heading level (e.g., H1, H2, H3). H1 is the highest level.'),
      text: z.string().describe('The text of the heading.'),
      page: z.number().int().describe('The page number where the heading appears.'),
    })
  ).describe('A structured, hierarchical outline of the document. If no distinct headings are found, this should be an empty array.'),
});
export type ExtractDocumentOutlineOutput = z.infer<typeof ExtractDocumentOutlineOutputSchema>;

export async function extractDocumentOutline(input: ExtractDocumentOutlineInput): Promise<ExtractDocumentOutlineOutput> {
  return extractDocumentOutlineFlow(input);
}

const prompt = ai.definePrompt({
  name: 'extractDocumentOutlinePrompt',
  input: {schema: ExtractDocumentOutlineInputSchema},
  output: {schema: ExtractDocumentOutlineOutputSchema},
  prompt: `You are an expert document analyst. Your task is to extract a structured outline from the provided PDF document.

Analyze the document's content, layout, and text styles to identify the main title and all hierarchical headings (like Chapter 1, Section 1.1, etc.).

- **Extract the main title:** Identify the primary title of the entire document.
- **Extract the outline:**
  - Identify all structural headings and their corresponding page numbers.
  - Determine the correct hierarchy (H1 for main sections, H2 for subsections, H3 for sub-subsections, etc.).
  - The text of a heading should not be identical to the main document title.
- **Handle Edge Cases:** If the document has no clear headings (e.g., it's a simple letter, a form, or just paragraphs), return an empty array for the "outline" field but still provide the title.

Return a valid JSON object matching the specified output schema.

Analyze the following PDF document:

{{media url=pdfDataUri}}
`,
});

const extractDocumentOutlineFlow = ai.defineFlow(
  {
    name: 'extractDocumentOutlineFlow',
    inputSchema: ExtractDocumentOutlineInputSchema,
    outputSchema: ExtractDocumentOutlineOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
