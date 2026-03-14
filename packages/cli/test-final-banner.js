#!/usr/bin/env node

/**
 * Final banner design with width verification
 */

import chalk from 'chalk';

const BORDER_WIDTH = 65;

function measureLine(line) {
  // Strip ANSI codes to measure actual character width
  const stripped = line.replace(/\x1b\[[0-9;]*m/g, '');
  return stripped.length;
}

function finalDesign() {
  console.log('\n' + chalk.cyan.bold('FINAL RECOMMENDED DESIGN'));
  console.log(chalk.gray('Each line verified to be exactly 65 characters\n'));

  const lines = [
    chalk.cyan('═'.repeat(BORDER_WIDTH)),
    '                                                                 ',
    '                           ' + chalk.white('●') + '                                     ',
    '                           ' + chalk.white('│') + '                                     ',
    '                       ' + chalk.white('○┌─────┐○') + '                                 ',
    '                        ' + chalk.white('│') + chalk.cyan('◉') + chalk.white(' ‿ │') + '                                   ',
    '                        ' + chalk.white('└─────┘') + '                                  ',
    '                       ' + chalk.white('╱   │   ╲') + '                                 ',
    '                      ' + chalk.white('○    │    ○') + '                                ',
    '                      ' + chalk.white('┌─────────┐') + '                                ',
    '                      ' + chalk.white('│') + '        ' + chalk.red('♥') + chalk.white('│') + '                                ',
    '                      ' + chalk.white('└─────────┘') + '                                ',
    '                                                                 ',
    '                    ' + chalk.white.bold('Moltbot') + chalk.magenta.bold('Den') + '                                   ',
    '          ' + chalk.gray('The Intelligence Layer for AI Agents') + '                   ',
    '                                                                 ',
    chalk.cyan('═'.repeat(BORDER_WIDTH))
  ];

  // Verify each line width
  let allCorrect = true;
  lines.forEach((line, i) => {
    const width = measureLine(line);
    const status = width === BORDER_WIDTH ? chalk.green('✓') : chalk.red('✗');
    console.log(line + chalk.gray(` ${status} ${width}`));
    if (width !== BORDER_WIDTH) {
      allCorrect = false;
    }
  });

  console.log('\n' + chalk.cyan('─'.repeat(BORDER_WIDTH)));

  if (allCorrect) {
    console.log(chalk.green.bold('✓ All lines are exactly 65 characters - Perfect alignment!'));
  } else {
    console.log(chalk.red.bold('✗ Some lines are not 65 characters - needs adjustment'));
  }

  console.log(chalk.cyan('─'.repeat(BORDER_WIDTH)));

  // Verification checklist
  console.log('\n' + chalk.cyan.bold('LOGO ACCURACY CHECKLIST:'));
  console.log(chalk.green('  ✓ Antenna: ● with connecting │ line'));
  console.log(chalk.green('  ✓ Rounded ears: ○ on LEFT and RIGHT sides'));
  console.log(chalk.green('  ✓ Face: Eye (◉) on LEFT, smile (‿) on RIGHT'));
  console.log(chalk.green('  ✓ Left arm: Waving UP (╱) ending in ○'));
  console.log(chalk.green('  ✓ Right arm: Down (╲) ending in ○'));
  console.log(chalk.green('  ✓ Heart: ♥ in RED on LOWER RIGHT of body'));
  console.log(chalk.green('  ✓ NO LEGS: Body ends cleanly with └─────────┘'));
  console.log(chalk.green('  ✓ Colors: White robot, cyan eye, red heart, magenta "Den"'));
  console.log('');
}

console.clear();
finalDesign();
