import LinkedList from '../../collection/linked-list';
import ParchmentError from '../../error';
import Scope from '../../scope';
import type { Blot, BlotConstructor, Parent, Root } from './blot';
import ShadowBlot from './shadow';
// 创建htmlnode 对应的 blot，并且挂载
function makeAttachedBlot(node: Node, scroll: Root): Blot {
  const found = scroll.find(node);
  if (found) return found;
  try {
    return scroll.create(node);
  } catch (e) {
    const blot = scroll.create(Scope.INLINE);
    Array.from(node.childNodes).forEach((child: Node) => {
      blot.domNode.appendChild(child);
    });
    if (node.parentNode) {
      node.parentNode.replaceChild(blot.domNode, node);
    }
    blot.attach();
    return blot;
  }
}

class ParentBlot extends ShadowBlot implements Parent {
  /**
   * Whitelist array of Blots that can be direct children.
   */
  public static allowedChildren?: BlotConstructor[];

  /**
   * Default child blot to be inserted if this blot becomes empty.
   */
  public static defaultChild?: BlotConstructor;
  public static uiClass = '';

  public children!: LinkedList<Blot>;
  // public domNode!: HTMLElement;
  public uiNode: HTMLElement | null = null;

  constructor(scroll: Root, domNode: Node) {
    super(scroll, domNode);
    // this.domNode = domNode as any;
    this.build();
  }
  // other 插入到 children ,children = [..., other] ,并且插入对于的html node 
  public appendChild(other: Blot): void {
    this.insertBefore(other);
  }

  public attach(): void {
    super.attach();
    this.children.forEach((child) => {
      child.attach();
    });
  }

  public attachUI(node: HTMLElement): void {
    if (this.uiNode != null) {
      this.uiNode.remove();
    }
    this.uiNode = node;
    if (ParentBlot.uiClass) {
      this.uiNode.classList.add(ParentBlot.uiClass);
    }
    this.uiNode.setAttribute('contenteditable', 'false');
    this.domNode.insertBefore(this.uiNode, this.domNode.firstChild);
  }

  /**
   * Called during construction, should fill its own children LinkedList.
   */
  public build(): void {
    this.children = new LinkedList<Blot>();
    // Need to be reversed for if DOM nodes already in order
    Array.from(this.domNode.childNodes)
      .filter((node: Node) => node !== this.uiNode)
      .reverse()
      .forEach((node: Node) => {
        try {
          const child = makeAttachedBlot(node, this.scroll);
          this.insertBefore(child, this.children.head || undefined);
        } catch (err) {
          if (err instanceof ParchmentError) {
            return;
          } else {
            throw err;
          }
        }
      });
  }

  public deleteAt(index: number, length: number): void {
    if (index === 0 && length === this.length()) {
      return this.remove();
    }
    this.children.forEachAt(index, length, (child, offset, childLength) => {
      child.deleteAt(offset, childLength);
    });
  }

  public descendant<T extends Blot>(
    criteria: new (...args: any[]) => T,
    index: number,
  ): [T | null, number];
  public descendant(
    criteria: (blot: Blot) => boolean,
    index: number,
  ): [Blot | null, number];
  public descendant(criteria: any, index = 0): [Blot | null, number] {
    const [child, offset] = this.children.find(index);
    if (
      (criteria.blotName == null && criteria(child)) ||
      (criteria.blotName != null && child instanceof criteria)
    ) {
      return [child as any, offset];
    } else if (child instanceof ParentBlot) {
      return child.descendant(criteria, offset);
    } else {
      return [null, -1];
    }
  }
  // 返回符合条件(criteria)的 child blots，递归遍历获取 
  public descendants<T extends Blot>(
    criteria: new (...args: any[]) => T,
    index?: number,
    length?: number,
  ): T[];
  public descendants(
    criteria: (blot: Blot) => boolean,
    index?: number,
    length?: number,
  ): Blot[];
  public descendants(
    criteria: any,
    index = 0,
    length: number = Number.MAX_VALUE,
  ): Blot[] {
    let descendants: Blot[] = [];
    let lengthLeft = length;
    this.children.forEachAt(
      index,
      length,
      (child: Blot, childIndex: number, childLength: number) => {
        if (
          (criteria.blotName == null && criteria(child)) ||
          (criteria.blotName != null && child instanceof criteria)
        ) {
          descendants.push(child);
        }
        if (child instanceof ParentBlot) {
          descendants = descendants.concat(
            child.descendants(criteria, childIndex, lengthLeft),
          );
        }
        lengthLeft -= childLength;
      },
    );
    return descendants;
  }

  public detach(): void {
    this.children.forEach((child) => {
      child.detach();
    });
    super.detach();
  }
  /**
   *  强制确保当前节点的子节点都是“被允许”的类型
   */
  public enforceAllowedChildren(): void {
    let done = false;
    this.children.forEach((child: Blot) => {
      if (done) {
        return;
      }
      const allowed = this.statics.allowedChildren.some(
        (def: BlotConstructor) => child instanceof def,
      );
      if (allowed) {
        return;
      }
      // 如果不是allow的 blot ，进行拆分和删除
      if (child.statics.scope === Scope.BLOCK_BLOT) {
        if (child.next != null) {
          this.splitAfter(child);
        }
        if (child.prev != null) { // child.next的内容已经重新插入到new blot 下
          this.splitAfter(child.prev);
        }
        child.parent.unwrap();
        done = true;
      } else if (child instanceof ParentBlot) {
        child.unwrap();
      } else {
        child.remove();
      }
    });
  }

  public formatAt(
    index: number,
    length: number,
    name: string,
    value: any,
  ): void {
    this.children.forEachAt(index, length, (child, offset, childLength) => {
      child.formatAt(offset, childLength, name, value);
    });
  }

  public insertAt(index: number, value: string, def?: any): void {
    const [child, offset] = this.children.find(index);
    if (child) {// 在child 内插入
      child.insertAt(offset, value, def);
    } else {// 在children 内插入：插入到[...,blot]
      const blot =
        def == null
          ? this.scroll.create('text', value)
          : this.scroll.create(value, def);
      this.appendChild(blot);
    }
  }
  // 插入到双向链表 和 html 
  public insertBefore(childBlot: Blot, refBlot?: Blot | null): void {
    if (childBlot.parent != null) {
      childBlot.parent.children.remove(childBlot);
    }
    let refDomNode: Node | null = null;
    this.children.insertBefore(childBlot, refBlot || null);
    childBlot.parent = this;
    if (refBlot != null) {
      refDomNode = refBlot.domNode;
    }
    if (
      this.domNode.parentNode !== childBlot.domNode ||
      this.domNode.nextSibling !== refDomNode
    ) {
      this.domNode.insertBefore(childBlot.domNode, refDomNode);
    }
    childBlot.attach();
  }

  public length(): number {
    return this.children.reduce((memo, child) => {
      return memo + child.length();
    }, 0);
  }

  public moveChildren(targetParent: Parent, refNode?: Blot | null): void {
    this.children.forEach((child) => {
      targetParent.insertBefore(child, refNode);
    });
  }
  /**
   * 1. 执行 是否需要 wrap
   * 2. check 子节点都是“被允许”的类型
   * 3. 更新uinode pos，必须是 firstChild，更新
   * 4. 插入默认 child
   */
  public optimize(context?: { [key: string]: any }): void {
    super.optimize(context);
    this.enforceAllowedChildren();
    if (this.uiNode != null && this.uiNode !== this.domNode.firstChild) { // attachUI,uiNode 是 firstChild，更新
      this.domNode.insertBefore(this.uiNode, this.domNode.firstChild);
    }
    if (this.children.length === 0) {
      if (this.statics.defaultChild != null) { // 如果空，创建默认blot
        const child = this.scroll.create(this.statics.defaultChild.blotName);
        this.appendChild(child);
        // TODO double check if necessary
        // child.optimize(context);
      } else {
        this.remove();
      }
    }
  }

  public path(index: number, inclusive = false): [Blot, number][] {
    const [child, offset] = this.children.find(index, inclusive);
    const position: [Blot, number][] = [[this, index]];
    if (child instanceof ParentBlot) {
      return position.concat(child.path(offset, inclusive));
    } else if (child != null) {
      position.push([child, offset]);
    }
    return position;
  }

  public removeChild(child: Blot): void {
    this.children.remove(child);
  }

  public replaceWith(name: string | Blot, value?: any): Blot {
    const replacement =
      typeof name === 'string' ? this.scroll.create(name, value) : name;
    if (replacement instanceof ParentBlot) {
      this.moveChildren(replacement);
    }
    return super.replaceWith(replacement);
  }
  // 将children ，从 index 所在的blot 分开，前面部分保持this，后面部分插入到新的clone(this),返回后面的blot
  public split(index: number, force = false): Blot | null {
    if (!force) {
      if (index === 0) {
        return this;
      }
      if (index === this.length()) {
        return this.next;
      }
    }
    const after = this.clone() as ParentBlot;
    if (this.parent) {
      this.parent.insertBefore(after, this.next || undefined);
    }
    this.children.forEachAt(index, this.length(), (child, offset, _length) => {
      const split = child.split(offset, force);
      if (split != null) {
        after.appendChild(split);
      }
    });
    return after;
  }
  // 将 child 和 之后的 blot 插入到 this.clone 
  public splitAfter(child: Blot): Parent {
    const after = this.clone() as ParentBlot;
    while (child.next != null) {
      after.appendChild(child.next);
    }
    if (this.parent) {
      this.parent.insertBefore(after, this.next || undefined);
    }
    return after;
  }
  // 将当前blot 删除，并且所有的 child blot 插入到 parent
  public unwrap(): void {
    if (this.parent) {
      this.moveChildren(this.parent, this.next || undefined);
    }
    this.remove();
  }
  // 对于add 和 del 的 blot 执行 挂载 和卸载，并且创建对应的 node
  public update(
    mutations: MutationRecord[],
    _context: { [key: string]: any },
  ): void {
    const addedNodes: Node[] = [];
    const removedNodes: Node[] = [];
    mutations.forEach((mutation) => {
      if (mutation.target === this.domNode && mutation.type === 'childList') {
        addedNodes.push(...mutation.addedNodes);
        removedNodes.push(...mutation.removedNodes);
      }
    });
    // 删除node 对应的 blot ，并且卸载
    removedNodes.forEach((node: Node) => {
      // Check node has actually been removed
      // One exception is Chrome does not immediately remove IFRAMEs
      // from DOM but MutationRecord is correct in its reported removal
      if ( // 如果html node 已经删除了，return
        node.parentNode != null &&
        // @ts-expect-error Fix me later
        node.tagName !== 'IFRAME' &&
        document.body.compareDocumentPosition(node) &
          Node.DOCUMENT_POSITION_CONTAINED_BY
      ) {
        return;
      }
      const blot = this.scroll.find(node);
      if (blot == null) {
        return;
      }
      if (
        blot.domNode.parentNode == null ||
        blot.domNode.parentNode === this.domNode
      ) {
        blot.detach(); // 删除
      }
    });
    addedNodes
      .filter((node) => {
        return node.parentNode === this.domNode && node !== this.uiNode;
      })
      .sort((a, b) => { // 按照dom顺序排序 [a,b]
        if (a === b) {
          return 0;
        }// b 在 a 之后
        if (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) {
          return 1;
        }
        return -1;
      })
      .forEach((node) => {
        let refBlot: Blot | null = null;
        if (node.nextSibling != null) {
          refBlot = this.scroll.find(node.nextSibling);
        }
        const blot = makeAttachedBlot(node, this.scroll);// 创建挂载 blot
        if (blot.next !== refBlot || blot.next == null) {
          if (blot.parent != null) {
            blot.parent.removeChild(this);
          }
          this.insertBefore(blot, refBlot || undefined);
        }
      });
    this.enforceAllowedChildren();
  }
}

export default ParentBlot;
