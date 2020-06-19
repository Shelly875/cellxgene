import * as globals from "../globals";
import {
  AnnoMatrixLoader,
  AnnoMatrixObsCrossfilter,
  clip,
  isubsetMask,
} from "../util/annoMatrix";
import {
  catchErrorsWrap,
  doJsonRequest,
  dispatchNetworkErrorMessageToUser,
} from "../util/actionHelpers";
import { requestReembed /* , reembedResetWorldToUniverse */ } from "./reembed";
import { loadUserColorConfig } from "../util/stateManager/colorHelpers";
import * as selnActions from "./selection";
import * as annoActions from "./annotation";

/*
return promise fetching user-configured colors
*/
async function userColorsFetchAndLoad(dispatch) {
  return fetchJson("colors").then((response) =>
    dispatch({
      type: "universe: user color load success",
      userColors: loadUserColorConfig(response),
    })
  );
}

async function schemaFetch() {
  return fetchJson("schema");
}

async function configFetch(dispatch) {
  return fetchJson("config").then((response) => {
    const config = { ...globals.configDefaults, ...response.config };
    dispatch({
      type: "configuration load complete",
      config,
    });
    return config;
  });
}

/*
Application bootstrap
*/
const doInitialDataLoad = () =>
  catchErrorsWrap(async (dispatch) => {
    dispatch({ type: "initial data load start" });

    const [, schema] = await Promise.all([
      configFetch(dispatch),
      schemaFetch(dispatch),
      userColorsFetchAndLoad(dispatch),
    ]);

    const baseDataUrl = `${globals.API.prefix}${globals.API.version}`;
    const annoMatrix = new AnnoMatrixLoader(baseDataUrl, schema.schema);
    const obsCrossfilter = new AnnoMatrixObsCrossfilter(annoMatrix);
    dispatch({
      type: "annoMatrix: init complete",
      annoMatrix,
      obsCrossfilter,
    });

    dispatch({ type: "initial data load complete" });
  }, true);

function requestSingleGeneExpressionCountsForColoringPOST(gene) {
  return {
    type: "color by expression",
    gene,
  };
}

const requestUserDefinedGene = (gene) => ({
  type: "request user defined gene success",
  data: {
    genes: [gene],
  },
});

const dispatchDiffExpErrors = (dispatch, response) => {
  switch (response.status) {
    case 403:
      dispatchNetworkErrorMessageToUser(
        "Too many cells selected for differential experesion calculation - please make a smaller selection."
      );
      break;
    case 501:
      dispatchNetworkErrorMessageToUser(
        "Differential expression is not implemented."
      );
      break;
    default: {
      const msg = `Unexpected differential expression HTTP response ${response.status}, ${response.statusText}`;
      dispatchNetworkErrorMessageToUser(msg);
      dispatch({
        type: "request differential expression error",
        error: new Error(msg),
      });
    }
  }
};

const requestDifferentialExpression = (set1, set2, num_genes = 10) => async (
  dispatch,
  getState
) => {
  dispatch({ type: "request differential expression started" });
  try {
    /*
    Steps:
    1. get the most differentially expressed genes
    2. get expression data for each
    */
    const { annoMatrix } = getState();
    const varIndexName = annoMatrix.schema.annotations.var.index;

    // Legal values are null, Array or TypedArray.  Null is initial state.
    if (!set1) set1 = [];
    if (!set2) set2 = [];

    // These lines ensure that we convert any TypedArray to an Array.
    // This is necessary because JSON.stringify() does some very strange
    // things with TypedArrays (they are marshalled to JSON objects, rather
    // than being marshalled as a JSON array).
    set1 = Array.isArray(set1) ? set1 : Array.from(set1);
    set2 = Array.isArray(set2) ? set2 : Array.from(set2);

    const res = await fetch(
      `${globals.API.prefix}${globals.API.version}diffexp/obs`,
      {
        method: "POST",
        headers: new Headers({
          Accept: "application/json",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          mode: "topN",
          count: num_genes,
          set1: { filter: { obs: { index: set1 } } },
          set2: { filter: { obs: { index: set2 } } },
        }),
        credentials: "include",
      }
    );

    if (!res.ok || res.headers.get("Content-Type") !== "application/json") {
      return dispatchDiffExpErrors(dispatch, res);
    }

    const response = await res.json();
    const varIndex = await annoMatrix.fetch("var", varIndexName);
    const data = response.map((v) => [
      varIndex.at(v[0], varIndexName),
      ...v.slice(1),
    ]);

    /* then send the success case action through */
    return dispatch({
      type: "request differential expression success",
      data,
    });
  } catch (error) {
    return dispatch({
      type: "request differential expression error",
      error,
    });
  }
};

const clipAction = (min, max) => (dispatch, getState) => {
  /*
  apply a clip to the current annoMatrix.  By convention, the clip
  view is ALWAYS the top view.
  */
  const { annoMatrix: prevAnnoMatrix } = getState();
  const annoMatrix = prevAnnoMatrix.isClipped
    ? clip(prevAnnoMatrix.viewOf, min, max)
    : clip(prevAnnoMatrix, min, max);
  const obsCrossfilter = new AnnoMatrixObsCrossfilter(annoMatrix);
  dispatch({
    type: "set clip quantiles",
    clipQuantiles: { min, max },
    annoMatrix,
    obsCrossfilter,
  });
};

const subsetAction = () => (dispatch, getState) => {
  /*
  Subset the annoMatrix to the current crossfilter selection
  */
  const {
    annoMatrix: prevAnnoMatrix,
    obsCrossfilter: prevObsCrossfilter,
  } = getState();

  const annoMatrix = isubsetMask(
    prevAnnoMatrix,
    prevObsCrossfilter.allSelectedMask()
  );
  const obsCrossfilter = new AnnoMatrixObsCrossfilter(annoMatrix);
  dispatch({
    type: "subset to selection",
    annoMatrix,
    obsCrossfilter,
  });
};

const resetSubsetAction = () => (dispatch, getState) => {
  /*
  Reset the annoMatrix to all data.  Because we may have multiple views
  stacked, we pop them all.  By convention, any clip transformation will
  be the top of the stack, and must be preserved.
  */

  const { annoMatrix: prevAnnoMatrix } = getState();

  const clipRange = prevAnnoMatrix.isClipped ? prevAnnoMatrix.clipRange : null;

  /* pop all views */
  let annoMatrix = prevAnnoMatrix;
  while (annoMatrix.isView) {
    annoMatrix = annoMatrix.viewOf;
  }

  /* re-apply the clip, if any */
  if (clipRange !== null) {
    annoMatrix = clip(annoMatrix, ...clipRange);
  }

  const obsCrossfilter = new AnnoMatrixObsCrossfilter(annoMatrix);
  dispatch({
    type: "reset subset",
    annoMatrix,
    obsCrossfilter,
  });
};

function fetchJson(pathAndQuery) {
  return doJsonRequest(
    `${globals.API.prefix}${globals.API.version}${pathAndQuery}`
  );
}

export default {
  doInitialDataLoad,
  requestDifferentialExpression,
  requestSingleGeneExpressionCountsForColoringPOST,
  requestUserDefinedGene,
  requestReembed,
  selectContinuousMetadataAction: selnActions.selectContinuousMetadataAction,
  selectCategoricalMetadataAction: selnActions.selectCategoricalMetadataAction,
  selectCategoricalAllMetadataAction:
    selnActions.selectCategoricalAllMetadataAction,
  graphBrushStartAction: selnActions.graphBrushStartAction,
  graphBrushChangeAction: selnActions.graphBrushChangeAction,
  graphBrushDeselectAction: selnActions.graphBrushDeselectAction,
  graphBrushCancelAction: selnActions.graphBrushCancelAction,
  graphBrushEndAction: selnActions.graphBrushEndAction,
  graphLassoStartAction: selnActions.graphLassoStartAction,
  graphLassoEndAction: selnActions.graphLassoEndAction,
  graphLassoCancelAction: selnActions.graphLassoCancelAction,
  graphLassoDeselectAction: selnActions.graphLassoDeselectAction,
  clipAction,
  subsetAction,
  resetSubsetAction,
  annotationCreateCategoryAction: annoActions.annotationCreateCategoryAction,
  annotationRenameCategoryAction: annoActions.annotationRenameCategoryAction,
  annotationDeleteCategoryAction: annoActions.annotationDeleteCategoryAction,
  annotationCreateLabelInCategory: annoActions.annotationCreateLabelInCategory,
  annotationDeleteLabelFromCategory:
    annoActions.annotationDeleteLabelFromCategory,
  annotationRenameLabelInCategory: annoActions.annotationRenameLabelInCategory,
  annotationLabelCurrentSelection: annoActions.annotationLabelCurrentSelection,
  saveObsAnnotationsAction: annoActions.saveObsAnnotationsAction,
  needToSaveObsAnnotations: annoActions.needToSaveObsAnnotations,
};
