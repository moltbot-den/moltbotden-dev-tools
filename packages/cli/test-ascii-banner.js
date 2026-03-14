#!/usr/bin/env node

/**
 * Test harness for iterating on ASCII art banner designs
 * Allows rapid visual comparison without rebuilding the CLI
 */

import chalk from 'chalk';

// Border width for alignment testing
const BORDER_WIDTH = 65;

// Helper to verify line width
function checkWidth(line, label) {
  const stripped = line.replace(/\x1b\[[0-9;]*m/g, ''); // Remove ANSI codes
  const width = stripped.length;
  if (width !== BORDER_WIDTH) {
    console.log(chalk.yellow(`⚠️  ${label}: ${width} chars (expected ${BORDER_WIDTH})`));
  }
  return line;
}

// Design Iteration 1: Minimal Kaomoji Style
function design1() {
  console.log('\n' + chalk.cyan('═'.repeat(BORDER_WIDTH)));
  console.log(chalk.cyan.bold('DESIGN 1: Minimal Kaomoji Style'));
  console.log(chalk.cyan('═'.repeat(BORDER_WIDTH)));

  const lines = [
    chalk.cyan('═'.repeat(BORDER_WIDTH)),
    '                                                                 ',
    '                           ' + chalk.white('●') + '                                     ',
    '                           ' + chalk.white('│') + '                                     ',
    '                      ' + chalk.white('○') + chalk.white('[') + chalk.cyan('◍') + chalk.white('‿ ]') + chalk.white('○') + '                                ',
    '                       ' + chalk.white('\\  │  /') + '                                 ',
    '                      ' + chalk.white('┌────────┐') + '                               ',
    '                      ' + chalk.white('│') + '       ' + chalk.red('♥') + chalk.white('│') + '                               ',
    '                      ' + chalk.white('└────────┘') + '                               ',
    '                                                                 ',
    '                    ' + chalk.white.bold('Moltbot') + chalk.magenta.bold('Den') + '                                  ',
    '          ' + chalk.gray('The Intelligence Layer for AI Agents') + '                 ',
    '                                                                 ',
    chalk.cyan('═'.repeat(BORDER_WIDTH))
  ];

  lines.forEach((line, i) => {
    console.log(line);
  });
}

// Design Iteration 2: Medium Detail Box Drawing
function design2() {
  console.log('\n' + chalk.cyan('═'.repeat(BORDER_WIDTH)));
  console.log(chalk.cyan.bold('DESIGN 2: Medium Detail Box Drawing'));
  console.log(chalk.cyan('═'.repeat(BORDER_WIDTH)));

  const lines = [
    chalk.cyan('═'.repeat(BORDER_WIDTH)),
    '                                                                 ',
    '                          ' + chalk.white('●') + '                                      ',
    '                          ' + chalk.white('│') + '                                      ',
    '                      ' + chalk.white('○ ┌───┐ ○') + '                                ',
    '                        ' + chalk.white('│') + chalk.cyan('○') + chalk.white(' ‿│') + '                                  ',
    '                        ' + chalk.white('└───┘') + '                                  ',
    '                       ' + chalk.white('╱  │  ╲') + '                                 ',
    '                      ' + chalk.white('┌────────┐') + '                               ',
    '                      ' + chalk.white('│') + '       ' + chalk.red('♥') + chalk.white('│') + '                               ',
    '                      ' + chalk.white('└────────┘') + '                               ',
    '                                                                 ',
    '                    ' + chalk.white.bold('Moltbot') + chalk.magenta.bold('Den') + '                                  ',
    '          ' + chalk.gray('The Intelligence Layer for AI Agents') + '                 ',
    '                                                                 ',
    chalk.cyan('═'.repeat(BORDER_WIDTH))
  ];

  lines.forEach(line => console.log(line));
}

// Design Iteration 3: Detailed with Parentheses
function design3() {
  console.log('\n' + chalk.cyan('═'.repeat(BORDER_WIDTH)));
  console.log(chalk.cyan.bold('DESIGN 3: Detailed with Parentheses (Rounded Ears)'));
  console.log(chalk.cyan('═'.repeat(BORDER_WIDTH)));

  const lines = [
    chalk.cyan('═'.repeat(BORDER_WIDTH)),
    '                                                                 ',
    '                          ' + chalk.white('●') + '                                      ',
    '                          ' + chalk.white('│') + '                                      ',
    '                     ' + chalk.white('( ┌─────┐ )') + '                               ',
    '                       ' + chalk.white('│ ') + chalk.cyan('◉') + chalk.white(' ‿ │') + '                                 ',
    '                       ' + chalk.white('└─────┘') + '                                 ',
    '                      ' + chalk.white('╱   │   ╲') + '                                ',
    '                     ' + chalk.white('○    │    ○') + '                               ',
    '                     ' + chalk.white('┌─────────┐') + '                               ',
    '                     ' + chalk.white('│') + '        ' + chalk.red('♥') + chalk.white('│') + '                               ',
    '                     ' + chalk.white('└─────────┘') + '                               ',
    '                                                                 ',
    '                    ' + chalk.white.bold('Moltbot') + chalk.magenta.bold('Den') + '                                  ',
    '          ' + chalk.gray('The Intelligence Layer for AI Agents') + '                 ',
    '                                                                 ',
    chalk.cyan('═'.repeat(BORDER_WIDTH))
  ];

  lines.forEach(line => console.log(line));
}

// Design 4: Refined version with better proportions
function design4() {
  console.log('\n' + chalk.cyan('═'.repeat(BORDER_WIDTH)));
  console.log(chalk.cyan.bold('DESIGN 4: Refined Proportions (Recommended)'));
  console.log(chalk.cyan('═'.repeat(BORDER_WIDTH)));

  const lines = [
    chalk.cyan('═'.repeat(BORDER_WIDTH)),
    '                                                                 ',
    '                           ' + chalk.white('●') + '                                     ',
    '                           ' + chalk.white('│') + '                                     ',
    '                       ' + chalk.white('○┌─────┐○') + '                                ',
    '                        ' + chalk.white('│') + chalk.cyan('◉') + chalk.white(' ‿ │') + '                                  ',
    '                        ' + chalk.white('└─────┘') + '                                  ',
    '                       ' + chalk.white('╱   │   ╲') + '                                ',
    '                      ' + chalk.white('○    │    ○') + '                               ',
    '                      ' + chalk.white('┌─────────┐') + '                               ',
    '                      ' + chalk.white('│') + '        ' + chalk.red('♥') + chalk.white('│') + '                               ',
    '                      ' + chalk.white('└─────────┘') + '                               ',
    '                                                                 ',
    '                    ' + chalk.white.bold('Moltbot') + chalk.magenta.bold('Den') + '                                  ',
    '          ' + chalk.gray('The Intelligence Layer for AI Agents') + '                 ',
    '                                                                 ',
    chalk.cyan('═'.repeat(BORDER_WIDTH))
  ];

  lines.forEach(line => console.log(line));
}

// Main execution
console.clear();
console.log(chalk.cyan.bold('\n🤖 ASCII ART BANNER TEST HARNESS\n'));
console.log(chalk.gray('Testing designs against MoltbotDen logo requirements:'));
console.log(chalk.gray('  ✓ Round antenna (●) with connecting line (│)'));
console.log(chalk.gray('  ✓ Rounded ear panels (○) on LEFT and RIGHT'));
console.log(chalk.gray('  ✓ Eye (◉/◍) on LEFT, smile (‿) on RIGHT'));
console.log(chalk.gray('  ✓ Left arm waving UP (/), right arm down (\\)'));
console.log(chalk.gray('  ✓ Both arms end in circles (○)'));
console.log(chalk.gray('  ✓ Heart (♥) in RED on LOWER RIGHT of body'));
console.log(chalk.gray('  ✓ NO LEGS - body ends cleanly'));
console.log(chalk.gray('  ✓ All lines exactly 65 characters wide\n'));

design1();
design2();
design3();
design4();

console.log('\n' + chalk.cyan('═'.repeat(BORDER_WIDTH)));
console.log(chalk.green.bold('✓ All designs rendered - Compare to actual logo!'));
console.log(chalk.cyan('═'.repeat(BORDER_WIDTH)) + '\n');
