
"use client";

import { useState, useEffect } from 'react';
import * as pdfjs from 'pdfjs-dist';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { UploadCloud, LoaderCircle, FileJson, Copy, AlertCircle, Check, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

// Set up the worker for pdf.js
if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
}

// --- Type Definitions ---
interface TextItem {
  str: string;
  transform: number[];
  height: number;
  fontName: string;
}

interface Line {
  text: string;
  x: number;
  y: number;
  height: number;
  fontName: string;
  page: number;
}

interface Heading {
  text: string;
  level: 'H1' | 'H2' | 'H3' | 'H4' | 'H5' | 'H6';
  page: number;
}

interface Outline {
  title: string;
  outline: Heading[];
}

interface FontStats {
  size: number;
  count: number;
}

// --- Helper Functions for PDF Processing ---

/**
 * Extracts all lines of text from a single page of a PDF.
 */
const getLinesFromPage = async (page: pdfjs.PDFPageProxy): Promise<Line[]> => {
  const textContent = await page.getTextContent();
  const items: TextItem[] = textContent.items as TextItem[];
  const lines: Line[] = [];

  if (!items.length) return lines;

  // Group items by line, based on Y-coordinate
  const itemGroups: { [key: number]: TextItem[] } = {};
  items.forEach(item => {
    const y = Math.round(item.transform[5]);
    if (!itemGroups[y]) itemGroups[y] = [];
    itemGroups[y].push(item);
  });

  for (const y in itemGroups) {
    const group = itemGroups[y].sort((a, b) => a.transform[4] - b.transform[4]); // Sort by X-coordinate
    const text = group.map(item => item.str).join(' ');
    const firstItem = group[0];
    lines.push({
      text: text.trim().replace(/\s+/g, ' '),
      x: firstItem.transform[4],
      y: parseFloat(y),
      height: firstItem.height,
      fontName: firstItem.fontName,
      page: page.pageNumber,
    });
  }

  // Sort lines by their vertical position on the page
  return lines.sort((a, b) => b.y - a.y);
};


/**
 * Analyzes the font sizes used throughout the document to determine heading levels.
 */
const getFontStatistics = (lines: Line[]): { headingSizes: number[], bodySize: number } => {
  const fontStats: { [key: number]: number } = {};
  lines.forEach(line => {
    if (line.height && line.text.length > 2) {
      const height = Math.round(line.height);
      fontStats[height] = (fontStats[height] || 0) + line.text.length;
    }
  });

  const sortedFonts = Object.entries(fontStats)
    .sort(([, countA], [, countB]) => countB - countA)
    .map(([size]) => parseFloat(size));

  const bodySize = sortedFonts[0] || 12;
  const headingSizes = sortedFonts.filter(size => size > bodySize).sort((a, b) => b - a);
  
  return { headingSizes, bodySize };
};


const classifyHeadings = (lines: Line[], titleText: string, headingSizes: number[]): Heading[] => {
  const outline: Heading[] = [];

  const getHeadingLevel = (height: number): Heading['level'] | null => {
    const roundedHeight = Math.round(height);
    const index = headingSizes.indexOf(roundedHeight);
    if (index === -1) return null;
    if (index < 6) return `H${index + 1}` as Heading['level'];
    return 'H6';
  };

  lines.forEach(line => {
    const level = getHeadingLevel(line.height);
    const isNumeric = /^\d+$/.test(line.text);
    const isTitle = line.text.toLowerCase() === titleText.toLowerCase();

    if (level && line.text.length > 3 && !isNumeric && !isTitle) {
      outline.push({
        text: line.text,
        level: level,
        page: line.page,
      });
    }
  });
  
    // Remove duplicates
    const uniqueOutline = outline.filter((heading, index, self) =>
      index === self.findIndex((h) => (
        h.text === heading.text && h.page === heading.page
      ))
    );

  return uniqueOutline;
};


/**
 * Extracts a structured outline from a PDF file using heuristics.
 */
const extractOutlineFromPdf = async (file: File): Promise<Outline> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  
    let allLines: Line[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const pageLines = await getLinesFromPage(page);
        allLines = allLines.concat(pageLines);
    }

    if (allLines.length === 0) {
        throw new Error("Could not extract any text from this document. It may be an image-only PDF.");
    }

    // Attempt to extract title
    const firstPageLines = allLines.filter(l => l.page <= 2).sort((a,b) => b.y - a.y);
    const maxFontSize = Math.max(...firstPageLines.map(l => l.height));
    const titleLines = firstPageLines
        .filter(line => Math.abs(line.height - maxFontSize) < 1)
        .sort((a,b) => b.y - a.y) // Sort from top to bottom
        .map(line => line.text);
    const title = titleLines.join(' ');
    
    // Determine heading font sizes
    const { headingSizes } = getFontStatistics(allLines);
    
    // Classify headings
    const outline = classifyHeadings(allLines, title, headingSizes);

    return { title, outline };
};


// --- Main Component and Logic ---

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [outline, setOutline] = useState<Outline | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const { toast } = useToast();
  
  const handleFileValidation = (selectedFile: File | null) => {
    if (selectedFile) {
      if (selectedFile.type !== 'application/pdf') {
        setError('Invalid file type. Please upload a PDF.');
        setFile(null);
        return false;
      }
      setError(null);
      setOutline(null);
      setFile(selectedFile);
      return true;
    }
    return false;
  }

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileValidation(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleFileValidation(e.target.files[0]);
    }
  };
  
  const clearFileInput = () => {
    const fileInput = document.getElementById('pdf-upload') as HTMLInputElement;
    if (fileInput) {
      fileInput.value = '';
    }
  }

  const handleExtract = async () => {
    if (!file) {
      setError('Please select a file first.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setOutline(null);

    try {
      const result = await extractOutlineFromPdf(file);

      if (!result.title && result.outline.length === 0) {
        throw new Error("Could not extract a title or any headings. The document might be empty, an image, or corrupted.");
      }
      setOutline(result);
      setFile(null);
      clearFileInput();
    } catch (e: any) {
      console.error(e);
      setError(e.message || 'An unexpected error occurred during processing.');
      setOutline(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyToClipboard = () => {
    if (!outline) return;

    navigator.clipboard.writeText(JSON.stringify(outline, null, 2)).then(() => {
      setIsCopied(true);
      toast({
        title: "Copied to clipboard!",
        description: "The JSON output is now in your clipboard.",
      });
      setTimeout(() => setIsCopied(false), 2500);
    }).catch(err => {
      console.error("Clipboard copy failed:", err);
      setError("Failed to copy to clipboard.");
    });
  };

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-background p-4 sm:p-6 md:p-8" onDragEnter={handleDrag}>
      <Card className="w-full max-w-2xl shadow-2xl backdrop-blur-sm bg-card/80">
        <CardHeader className="text-center">
          <h1 className="font-headline text-4xl font-bold tracking-tighter">Docu<span className="text-primary">Outline</span></h1>
          <CardDescription className="text-lg">
            Instantly extract titles and headings from any PDF document. 100% offline.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form onSubmit={(e) => { e.preventDefault(); handleExtract(); }} onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}>
            <Label htmlFor="pdf-upload" className={cn("flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-lg cursor-pointer transition-colors", dragActive ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted/50")}>
              <div className="flex flex-col items-center justify-center pt-5 pb-6 text-center">
                {file ? (
                  <>
                    <FileText className="w-12 h-12 mb-4 text-primary" />
                    <p className="mb-2 font-semibold text-foreground">{file.name}</p>
                    <p className="text-xs text-muted-foreground">({(file.size / 1024).toFixed(2)} KB) - Ready to extract!</p>
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-12 h-12 mb-4 text-muted-foreground" />
                    <p className="mb-2 text-sm text-muted-foreground">
                      <span className="font-semibold text-primary">Click to upload</span> or drag and drop
                    </p>
                    <p className="text-xs text-muted-foreground">PDF document (max 50MB)</p>
                  </>
                )}
              </div>
              <Input id="pdf-upload" type="file" accept=".pdf" className="hidden" onChange={handleFileChange} disabled={isLoading} />
            </Label>
          </form>

          <Button onClick={handleExtract} disabled={isLoading || !file} className="w-full text-lg py-6">
            {isLoading ? (
              <>
                <LoaderCircle className="mr-2 h-5 w-5 animate-spin" />
                Analyzing...
              </>
            ) : (
              "Extract Outline"
            )}
          </Button>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Extraction Failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {outline && (
            <div className="space-y-4 rounded-lg border bg-muted/30 p-4 animate-in fade-in-50">
              <div className="flex items-center justify-between">
                <h3 className="font-headline text-lg flex items-center gap-2">
                  <FileJson className="h-5 w-5 text-primary" />
                  Extracted JSON Outline
                </h3>
                <Button variant="ghost" size="sm" onClick={handleCopyToClipboard}>
                  {isCopied ? <Check className="h-4 w-4 text-accent-foreground" /> : <Copy className="h-4 w-4" />}
                  <span className="ml-2">{isCopied ? 'Copied!' : 'Copy'}</span>
                </Button>
              </div>
              <div className="relative">
                <pre className="w-full overflow-x-auto rounded-md bg-background p-4 font-code text-sm max-h-72">
                  <code>{JSON.stringify(outline, null, 2)}</code>
                </pre>
              </div>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex-col gap-1 pt-6 text-center text-xs text-muted-foreground">
            <p>Your document is processed entirely in your browser.</p>
            <p>No data is ever sent to a server.</p>
        </CardFooter>
      </Card>
    </div>
  );
}
