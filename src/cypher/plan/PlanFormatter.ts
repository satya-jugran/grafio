/**
 * Formatter for query execution plans.
 *
 * Converts a {@link QueryPlan} into different output formats:
 * - 'json'    → JSON string representation
 * - 'ascii'   → ASCII tree diagram
 * - 'mermaid' → Mermaid flowchart syntax
 *
 * @module cypher/plan/PlanFormatter
 */

import { Expression } from '../ast/AstNode';
import { QueryPlan, PlanStep, PropertyFilter } from './QueryPlan';

/**
 * Supported output formats for execution plan visualization.
 */
export type PlanFormat = 'json' | 'ascii' | 'mermaid';

/**
 * Formats a {@link QueryPlan} into various output formats for visualization
 * and debugging purposes.
 */
export class PlanFormatter {
  /**
   * Format a query plan into the specified output format.
   *
   * @param plan   - The query plan to format.
   * @param format - The output format: 'json' | 'ascii' | 'mermaid'.
   * @returns A formatted string representation of the plan.
   */
  format(plan: QueryPlan, format: PlanFormat): string {
    switch (format) {
      case 'json':
        return this.toJson(plan);
      case 'ascii':
        return this.toAscii(plan);
      case 'mermaid':
        return this.toMermaid(plan);
    }
  }

  /**
   * Convert plan to JSON string.
   */
  private toJson(plan: QueryPlan): string {
    return JSON.stringify(plan, null, 2);
  }

  /**
   * Convert plan to ASCII tree diagram.
   */
  private toAscii(plan: QueryPlan): string {
    const lines: string[] = [];
    const steps = plan.steps;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const isLast = i === steps.length - 1;
      const prefix = isLast ? '\u2514\u2014 ' : '\u251c\u2014 ';
      const stepDescription = this.describeStep(step);
      lines.push(prefix + stepDescription);
    }

    return lines.join('\n');
  }

  /**
   * Convert plan to Mermaid flowchart syntax.
   */
  private toMermaid(plan: QueryPlan): string {
    const lines: string[] = ['flowchart TD'];
    const steps = plan.steps;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const currentNode = 'Step' + (i + 1);
      const currentLabel = this.escapeMermaid(this.describeStepForMermaid(step));
      lines.push(' ' + currentNode + '[' + currentLabel + ']');

      if (i > 0) {
        const prevNode = 'Step' + i;
        lines.push(' ' + prevNode + ' --> ' + currentNode);
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate a description of a plan step suitable for Mermaid labels.
   * Uses angle brackets instead of parentheses for safety.
   */
  private describeStepForMermaid(step: PlanStep): string {
    switch (step.kind) {
      case 'NodeScanStep':
        return 'NodeScanStep ' + step.variable + (step.label ? ':' + step.label : '') + ' &lcub; ' + this.getPropertyFilterDescription(step.propertyFilters?.[0] || {}) + ' &rcub;';

      case 'NodeSeekStep':
        if (step.index === 'id') {
          return 'NodeSeekStep id=' + step.value;
        }
        return 'NodeSeekStep ' + step.key + '=' + step.value;

      case 'EdgeExpandStep': {
        const dir = step.direction === 'out' ? '->' : '<-';
        const edgeVar = step.edgeVar ? ' ' + step.edgeVar : '';
        const targetTypes = step.targetTypes ? ':' + step.targetTypes.join(',') : '';
        return 'EdgeExpandStep' + edgeVar + ' ' + dir + ' ' + step.target + targetTypes;
      }

      case 'FilterStep':
        return 'FilterStep ' + this.getExpressionDescription(step.predicate);

      case 'ProjectStep': {
        const cols = step.columns.map(c => c.alias).join(', ');
        return 'ProjectStep' + (cols ? ' ' + cols : '') + (step.distinct ? ' DISTINCT' : '');
      }

      case 'SortStep': {
        const items = step.items.map(
          item => this.getExpressionDescription(item.expression) + ' ' + item.direction
        ).join(', ');
        return 'SortStep' + (items ? ' ' + items : '');
      }

      case 'LimitStep': {
        let limitDesc = 'LimitStep';
        if (step.skipExpr) limitDesc += ' SKIP ' + this.getExpressionDescription(step.skipExpr);
        if (step.limitExpr) limitDesc += ' LIMIT ' + this.getExpressionDescription(step.limitExpr);
        return limitDesc;
      }

      case 'AggregateStep': {
        const funcs = step.aggregates.map(a => a.function + '(' + a.alias + ')').join(', ');
        return 'AggregateStep' + (funcs ? ' ' + funcs : '');
      }

      default:
        return (step as PlanStep).kind;
    }
  }

  /**
   * Generate a short human-readable description of a plan step.
   */
  private describeStep(step: PlanStep): string {
    switch (step.kind) {
      case 'NodeScanStep':
        return 'NodeScanStep (' + step.variable + (step.label ? ':' + step.label : '') + (step.propertyFilters ? ' &lcub; ' + this.getPropertyFilterDescription(step.propertyFilters[0]) + ' &rcub;' : '') + ')';

      case 'NodeSeekStep':
        if (step.index === 'id') {
          return 'NodeSeekStep [id=' + step.value + ']';
        }
        return 'NodeSeekStep [' + step.key + '=' + step.value + ']';

      case 'EdgeExpandStep': {
        const dir = step.direction === 'out' ? '\u2192' : '\u2190';
        const edgeVar = step.edgeVar ? ' ' + step.edgeVar : '';
        const targetTypes = step.targetTypes ? ':' + step.targetTypes.join(',') : '';
        return 'EdgeExpandStep (' + dir + ')' + edgeVar + ' \u2192 ' + step.target + targetTypes;
      }

      case 'FilterStep':
        return 'FilterStep ' + this.getExpressionDescription(step.predicate);

      case 'ProjectStep': {
        const cols = step.columns.map(c => c.alias).join(', ');
        return 'ProjectStep [' + cols + ']' + (step.distinct ? ' DISTINCT' : '');
      }

      case 'SortStep': {
        const items = step.items.map(
          item => this.getExpressionDescription(item.expression) + ' ' + item.direction
        ).join(', ');
        return 'SortStep [' + items + ']';
      }

      case 'LimitStep': {
        let limitDesc = 'LimitStep';
        if (step.skipExpr) limitDesc += ' SKIP ' + this.getExpressionDescription(step.skipExpr);
        if (step.limitExpr) limitDesc += ' LIMIT ' + this.getExpressionDescription(step.limitExpr);
        return limitDesc;
      }

      case 'AggregateStep': {
        const funcs = step.aggregates.map(a => a.function + '(' + a.alias + ')').join(', ');
        return 'AggregateStep [' + funcs + ']';
      }

      default:
        return (step as PlanStep).kind;
    }
  }

  private getExpressionDescription(expr: Expression): string {
    switch (expr.kind) {
      case 'Literal':
        return JSON.stringify(expr.value);
      case 'Identifier':
        return expr.name;
      case 'PropertyAccess':
        return this.getExpressionDescription(expr.object) + '.' + expr.property;
      case 'Binary':
        return (
          this.getExpressionDescription(expr.left) +
          ' ' +
          expr.op +
          ' ' +
          this.getExpressionDescription(expr.right)
        );
      case 'Unary':
        return expr.op + this.getExpressionDescription(expr.operand);
      case 'In':
        return (
          this.getExpressionDescription(expr.expression) +
          ' IN ' +
          this.getExpressionDescription(expr.list)
        );
      case 'IsNull':
        return this.getExpressionDescription(expr.expression) + ' IS NULL';
      case 'List':
        return '[' + expr.elements.map(e => this.getExpressionDescription(e)).join(', ') + ']';
      case 'FunctionCall':
        const args = expr.args.map(a => this.getExpressionDescription(a)).join(', ');
        return expr.name + '(' + (expr.distinct ? 'DISTINCT ' : '') + args + ')';
      default:
        return expr.kind;
    }
  }

  private getPropertyFilterDescription(filter: PropertyFilter): string {
    let desc = '';
    if (filter.key) {
      desc += filter.key;
    }
    if (filter.op) {
      desc += ' ' + filter.op;
    }
    if (filter.value !== undefined) {
      desc += ' ' + JSON.stringify(filter.value);
    }
    if (filter.AND) {
      desc += ' AND (' + filter.AND.map(f => this.getPropertyFilterDescription(f)).join(' AND ') + ')';
    }
    if (filter.OR) {
      desc += ' OR (' + filter.OR.map(f => this.getPropertyFilterDescription(f)).join(' OR ') + ')';
    }
    return desc || '(no filters)';
  }

  /**
   * Generate a Mermaid node ID for a given step index.
   */
  private mermaidNodeId(index: number): string {
    return String.fromCharCode(65 + index); // A, B, C, ...
  }

  /**
   * Escape special characters for Mermaid diagram labels.
   */
  private escapeMermaid(text: string): string {
    return text
      .replace(/&/g, String.fromCharCode(38, 97, 109, 112, 59))
      .replace(/</g, String.fromCharCode(38, 108, 116, 59))
      .replace(/>/g, String.fromCharCode(38, 103, 116, 59))
      .replace(/"/g, String.fromCharCode(38, 113, 117, 111, 116, 59))
      .replace(/\x27/g, String.fromCharCode(38, 97, 112, 111, 115, 59))
      .replace(/\n/g, '<br/>');
  }
}