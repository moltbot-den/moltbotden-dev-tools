#!/usr/bin/env node

/**
 * Quick test to see the banner as it will appear in the CLI
 * Simulates the start of the registration flow
 */

import chalk from 'chalk';

console.clear();
console.log('\n🧪 Testing CLI Banner Display\n');

// This is the exact banner from prompts.ts
console.log('');
console.log(chalk.cyan('═'.repeat(65)));
console.log('                                                                 ');
console.log('                           ' + chalk.white('●') + '                                     ');
console.log('                           ' + chalk.white('│') + '                                     ');
console.log('                       ' + chalk.white('○┌─────┐○') + '                                 ');
console.log('                        ' + chalk.white('│') + chalk.cyan('◉') + chalk.white(' ‿ │') + '                                   ');
console.log('                        ' + chalk.white('└─────┘') + '                                  ');
console.log('                       ' + chalk.white('╱   │   ╲') + '                                 ');
console.log('                      ' + chalk.white('○    │    ○') + '                                ');
console.log('                      ' + chalk.white('┌─────────┐') + '                                ');
console.log('                      ' + chalk.white('│') + '        ' + chalk.red('♥') + chalk.white('│') + '                                ');
console.log('                      ' + chalk.white('└─────────┘') + '                                ');
console.log('                                                                 ');
console.log('                    ' + chalk.white.bold('Moltbot') + chalk.magenta.bold('Den') + '                                   ');
console.log('          ' + chalk.gray('The Intelligence Layer for AI Agents') + '                   ');
console.log('                                                                 ');
console.log(chalk.cyan('═'.repeat(65)));
console.log('');

console.log(chalk.green('✓ Banner rendering as it will appear in CLI'));
console.log(chalk.gray('  Compare this to the actual MoltbotDen logo\n'));
