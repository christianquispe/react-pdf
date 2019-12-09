import * as R from 'ramda';

import isText from '../node/isText';
import splitText from '../text/splitText';
import splitNode from '../node/splitNode';
import shouldNodeBreak from '../node/shouldBreak';
import getContentArea from '../page/getContentArea';
import resolveInheritance from './resolveInheritance';
import { resolvePageDimensions } from './resolveDimensions';

// Prevent splitting elements by low decimal numbers
const SAFTY_THRESHOLD = 0.001;

const assingChildren = R.assoc('children');

const getTop = R.pathOr(0, ['box', 'top']);

const getHeight = R.path(['box', 'height']);

const getChildren = R.propOr([], 'children');

const isElementOutside = R.useWith(R.lte, [R.identity, getTop]);

const isFixed = R.pathEq(['props', 'fixed'], true);

const allFixed = R.all(isFixed);

const isDynamic = R.hasPath(['props', 'render']);

const relayoutPage = R.compose(
  resolveInheritance,
  resolvePageDimensions,
);

const splitView = (node, height) => {
  const [currentNode, nextNode] = splitNode(node, height);
  const [currentChilds, nextChildren] = splitChildren(height, node);

  return [
    assingChildren(currentChilds)(currentNode),
    assingChildren(nextChildren)(nextNode),
  ];
};

const elevateNode = d => R.evolve({ box: { top: R.subtract(R.__, d) } });

const elevateNodes = (distance, nodes) => R.map(elevateNode(distance), nodes);

const split = R.ifElse(isText, splitText, splitView);

const splitNodes = (height, nodes) => {
  const currentChildren = [];
  const nextChildren = [];

  for (let i = 0; i < nodes.length; i++) {
    const child = nodes[i];
    const futureNodes = nodes.slice(i + 1);
    const futureFixedNodes = R.filter(isFixed, futureNodes);

    const nodeTop = getTop(child);
    const nodeHeight = getHeight(child);
    const isOutside = isElementOutside(height, child);
    const shouldBreak = shouldNodeBreak(child, futureNodes, height);
    const shouldSplit = height + SAFTY_THRESHOLD < nodeTop + nodeHeight;

    if (isFixed(child)) {
      nextChildren.push(child);
      currentChildren.push(child);
      continue;
    }

    if (isOutside) {
      const next = R.evolve({ box: { top: R.subtract(R.__, height) } })(child);
      nextChildren.push(next);
      continue;
    }

    if (shouldBreak) {
      const next = R.evolve({
        box: { top: R.subtract(R.__, height) },
        props: R.evolve({ break: R.always(false) }),
      })(child);

      currentChildren.push(...futureFixedNodes);
      nextChildren.push(next, ...elevateNodes(child.box.top, futureNodes));
      break;
    }

    if (shouldSplit) {
      const [currentChild, nextChild] = split(child, height);

      if (currentChild) currentChildren.push(currentChild);
      if (nextChild) nextChildren.push(nextChild);

      continue;
    }

    currentChildren.push(child);
  }

  return [currentChildren, nextChildren];
};

const splitChildren = (height, node) => {
  const children = getChildren(node);
  const availableHeight = height - getTop(node);
  return splitNodes(availableHeight, children);
};

const splitPage = (page, pageNumber) => {
  const contentArea = getContentArea(page, pageNumber);
  const height = R.path(['style', 'height'], page);
  const dynamicPage = resolveDynamicPage({ pageNumber }, page);

  const [currentChilds, nextChilds] = splitNodes(
    contentArea,
    dynamicPage.children,
  );

  const currentPage = R.compose(
    relayoutPage,
    assingChildren(currentChilds),
    R.assocPath(['box', 'height'], height),
  )(page);

  if (R.isEmpty(nextChilds) || allFixed(nextChilds)) return [currentPage, null];

  const nextPage = R.compose(
    assingChildren(nextChilds),
    R.dissocPath(['box', 'height']),
  )(page);

  return [currentPage, nextPage];
};

const shouldResolveDynamicNodes = node =>
  R.either(
    isDynamic,
    R.compose(
      R.any(shouldResolveDynamicNodes),
      R.propOr([], 'children'),
    ),
  )(node);

const resolveDynamicPage = (props, page) =>
  R.when(
    shouldResolveDynamicNodes,
    R.compose(
      relayoutPage,
      resolveDynamicNodes(props),
    ),
  )(page);

const resolveDynamicNodes = props => node => {
  const isNodeDynamic = R.always(isDynamic(node));

  const resolveRender = () => {
    const res = node.props.render(props);
    return [{ type: 'TEXT_INSTANCE', value: res }];
  };

  return R.evolve(
    {
      children: R.ifElse(
        isNodeDynamic,
        resolveRender,
        R.map(resolveDynamicNodes(props)),
      ),
      lines: R.when(isNodeDynamic, R.always([])),
    },
    node,
  );
};

const paginate = (page, pageNumber) => {
  if (!page) return [];

  let splittedPage = splitPage(page, pageNumber);

  const pages = [splittedPage[0]];
  let nextPage = splittedPage[1];

  while (nextPage !== null) {
    splittedPage = splitPage(nextPage, pageNumber + pages.length);

    pages.push(splittedPage[0]);
    nextPage = splittedPage[1];
  }

  return pages;
};

const resolvePageIndices = (page, pageNumber, pages) => {
  const totalPages = pages.length;
  return resolveDynamicPage({ pageNumber: pageNumber + 1, totalPages }, page);
};

const resolvePagination = doc => {
  let pages = [];
  let pageNumber = 1;

  for (let i = 0; i < doc.children.length; i++) {
    const page = doc.children[i];
    const subpages = paginate(page, pageNumber);

    pageNumber += subpages.length;
    pages = pages.concat(subpages);
  }

  return assingChildren(pages.map(resolvePageIndices), doc);
};

export default resolvePagination;
