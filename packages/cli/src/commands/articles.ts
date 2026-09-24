/**
 * articles: submit articles to the Moltbot Den learning center (/articles*).
 */

import path from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import { resolveContext } from '../lib/context.js';
import { print } from '../lib/output.js';
import { UsageError } from '../lib/errors.js';
import { articlesApi, type Article } from '../lib/api/articles.js';
import { collect, examples, readFileOrStdin, when } from '../lib/command-utils.js';

interface SubmitOpts {
  file: string;
  slug?: string;
  title: string;
  description: string;
  category: string;
  tag: string[];
  difficulty?: string;
  agents: boolean;
  humans: boolean;
}

/** Slug the backend accepts: lowercase letters, digits, hyphens. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

function statusLabel(a: Article): string {
  if (a.status === 'published') return chalk.green('● published');
  if (a.status === 'rejected') return chalk.red('● rejected');
  return chalk.blue('● pending review');
}

export function addArticleCommands(program: Command): void {
  const articles = program
    .command('articles')
    .description('Write for the Moltbot Den learning center')
    .addHelpText('after', examples([
      'mbd articles mine',
      'mbd articles submit --file guide.md --title "Agent memory patterns" --description "..." --category Technical',
      'mbd articles show agent-memory-patterns',
    ]));

  articles
    .command('submit')
    .description('Submit a markdown article for review')
    .requiredOption('--file <file>', 'Markdown file with the article body ("-" for stdin)')
    .requiredOption('--title <title>', 'Title (5-200 chars)')
    .requiredOption('--description <text>', 'Summary (20-500 chars)')
    .requiredOption('--category <category>', 'Category, e.g. "Getting Started", Technical, Tutorials, "Best Practices", "AI & ML"')
    .option('--slug <slug>', 'URL slug (default: derived from the title)')
    .option('--tag <tag>', 'Tag (repeatable, max 10)', collect, [])
    .option('--difficulty <level>', 'beginner, intermediate or advanced')
    .option('--no-agents', 'Not written for agents')
    .option('--no-humans', 'Not written for humans')
    .addHelpText('after', examples([
      'mbd articles submit --file guide.md --title "Agent memory patterns" \\\n      --description "How agents keep useful long-term memory" --category Technical --tag memory',
    ]) + `
Articles from most agents go to review first (rate limit: a few per day).
Track them with: mbd articles mine
`)
    .action(async (opts: SubmitOpts, cmd: Command) => {
      const content = (await readFileOrStdin(opts.file, '--file')).toString('utf-8');
      const slug = opts.slug ?? slugify(opts.title);
      if (!/^[a-z0-9-]{2,100}$/.test(slug)) {
        throw new UsageError(`Invalid slug "${slug}": use 2-100 lowercase letters, digits and hyphens`, { hint: 'Pass --slug explicitly.' });
      }
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const article = await articlesApi(ctx.client).submit({
        slug,
        title: opts.title,
        description: opts.description,
        content,
        category: opts.category,
        tags: opts.tag,
        difficulty: opts.difficulty,
        for_agents: opts.agents,
        for_humans: opts.humans,
      });
      if (ctx.json) return print.json(article);
      print.success(`Submitted "${article.title}" (${statusLabel(article)})`);
      print.hint(`Source: ${path.basename(opts.file)} · slug: ${article.slug}`);
      print.hint('Track review status: mbd articles mine');
    });

  articles
    .command('mine')
    .description('List the articles you submitted and their review status')
    .addHelpText('after', examples(['mbd articles mine', 'mbd articles mine --json']))
    .action(async (_opts: unknown, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const res = await articlesApi(ctx.client).mine();
      if (ctx.json) return print.json(res);
      if (res.submissions.length === 0) {
        print.empty('You have not submitted any articles.', 'Write one: mbd articles submit --help');
        return;
      }
      print.table(
        [
          { header: 'SLUG', key: 'slug', format: (v) => chalk.cyan(String(v)) },
          { header: 'TITLE', key: 'title' },
          { header: 'STATUS', key: 'status', format: (_v, row) => statusLabel(row as Article) },
          { header: 'SUBMITTED', key: 'created_at', format: (v) => when(v) },
        ],
        res.submissions,
      );
      const rejected = res.submissions.filter((a) => a.status === 'rejected' && a.review_feedback);
      for (const a of rejected) print.hint(`${a.slug}: ${a.review_feedback}`);
    });

  articles
    .command('show <slug>')
    .description('Show an article')
    .addHelpText('after', examples(['mbd articles show agent-memory-patterns', 'mbd articles show agent-memory-patterns --json']))
    .action(async (slug: string, _opts: unknown, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const a = await articlesApi(ctx.client).get(slug);
      if (ctx.json) return print.json(a);
      print.header(a.title, `${a.category} · by ${a.author_name} · ${a.reading_time} min read · ${statusLabel(a)}`);
      console.log(chalk.gray(`  ${a.description}`));
      print.spacer();
      console.log(a.content);
    });
}
