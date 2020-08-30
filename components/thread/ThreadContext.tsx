import React from "react";

import { useAuth } from "components/Auth";
import { getThreadData, markThreadAsRead } from "utils/queries";
import { useQuery, useMutation } from "react-query";
import {
  PostType,
  ThreadType,
  CategoryFilterType,
  ThreadPostInfoType,
  ThreadCommentInfoType,
} from "types/Types";
import {
  makePostsTree,
  extractCategories,
  applyCategoriesFilter,
  getThreadInBoardCache,
  updateThreadReadState,
  makeCommentsTree,
  extractAnswersSequence,
  UNCATEGORIZED_LABEL,
} from "utils/thread-utils";

import debug from "debug";
import { ThreadPageSSRContext } from "pages/[boardId]/thread/[...threadId]";
const log = debug("bobafrontend:threadProvider-log");
const info = debug("bobafrontend:threadProvider-info");

const ThreadContext = React.createContext({} as ThreadContextType);

interface ThreadContextType {
  // These two will never be null on thread paths.
  threadId: string;
  slug: string;
  // If the thread page points to a specific post within the thread,
  // then this will be the stringId of the post.
  postId: string | null;
  isLoading: boolean;
  // The root of the thread (a.k.a. the first post).
  threadRoot: PostType | null;
  // The current post targeted by the page.
  currentRoot: PostType | null;
  allPosts: PostType[];
  newAnswersSequence: { postId?: string; commentId?: string }[];
  filteredRoot: PostType | null;
  parentChildrenMap: Map<string, ThreadPostInfoType>;
  postCommentsMap: Map<string, ThreadCommentInfoType>;
  filteredParentChildrenMap: Map<string, ThreadPostInfoType>;
  categoryFilterState: { name: string; active: boolean }[];
  setCategoryFilterState: React.Dispatch<
    React.SetStateAction<{ name: string; active: boolean }[]>
  >;
  baseUrl: string;
}

const ThreadProvider: React.FC<ThreadPageSSRContext> = ({
  threadId,
  postId,
  slug,
  children,
}) => {
  const { isLoggedIn, isPending: isAuthPending } = useAuth();
  const baseUrl = `/!${slug}/thread/${threadId}`;

  const {
    data: threadData,
    isFetching: isFetchingThread,
    isStale: isThreadStale,
  } = useQuery<
    ThreadType,
    [
      string,
      {
        threadId: string;
      }
    ]
  >(["threadData", { threadId }], getThreadData, {
    refetchOnWindowFocus: false,
    initialData: () => {
      log(
        `Searching board activity data for board ${slug} and thread ${threadId}`
      );
      return getThreadInBoardCache({ slug, threadId })?.thread;
    },
    onSuccess: (data) => {
      log(`Retrieved thread data for thread with id ${threadId}`);
      info(data);
    },
    initialStale: true,
  });

  // Mark thread as read on authentication and thread fetch
  const [readThread] = useMutation(() => markThreadAsRead({ threadId }), {
    onSuccess: () => {
      log(`Successfully marked thread as read`);
      updateThreadReadState({ threadId, slug });
    },
  });
  React.useEffect(() => {
    if (!isAuthPending && !isFetchingThread && !isThreadStale && isLoggedIn) {
      readThread();
      return;
    }
  }, [isAuthPending, isFetchingThread, isThreadStale, isLoggedIn]);

  // Extract posts data in a format that is easily consumable by context consumers.
  const {
    root,
    parentChildrenMap,
    newAnswersSequence,
    postCommentsMap,
  } = React.useMemo(() => {
    info("Building posts tree from data:");
    info(threadData);
    const { root, parentChildrenMap, postsDisplaySequence } = makePostsTree(
      threadData?.posts,
      threadId
    );
    const postCommentsMap = new Map<string, ThreadCommentInfoType>();
    threadData?.posts?.forEach((post) => {
      log(`Creating comments tree for post ${postId}`);
      if (post.comments) {
        postCommentsMap.set(post.postId, makeCommentsTree(post.comments));
      }
    });

    return {
      root,
      parentChildrenMap,
      postCommentsMap,
      newAnswersSequence: postsDisplaySequence
        ? extractAnswersSequence(postsDisplaySequence, postCommentsMap)
        : [],
    };
  }, [threadData, threadId]);

  // Listen to category filter changes and update data accordingly.
  const [categoryFilterState, setCategoryFilterState] = React.useState<
    CategoryFilterType[]
  >([]);
  React.useEffect(() => {
    if (!threadData) {
      setCategoryFilterState([]);
      return;
    }
    const currentCategories = extractCategories(threadData.posts);
    currentCategories.push(UNCATEGORIZED_LABEL);
    log(`Current categories:`);
    log(currentCategories);
    setCategoryFilterState(
      currentCategories.map((category) => ({
        name: category,
        active:
          categoryFilterState.find(
            (stateCategory) => stateCategory.name == category
          )?.active || true,
      }))
    );
  }, [threadData, threadId]);

  const {
    root: filteredRoot,
    parentChildrenMap: filteredParentChildrenMap,
  } = React.useMemo(
    () => applyCategoriesFilter(root, parentChildrenMap, categoryFilterState),
    [root, parentChildrenMap, categoryFilterState]
  );

  return (
    <ThreadContext.Provider
      value={{
        threadId,
        postId,
        slug,
        baseUrl,
        isLoading: isFetchingThread,
        threadRoot: root,
        currentRoot:
          !!postId && threadData
            ? (threadData.posts.find(
                (post) => post.postId == postId
              ) as PostType)
            : root,
        allPosts: threadData?.posts || [],
        newAnswersSequence,
        filteredRoot,
        parentChildrenMap,
        filteredParentChildrenMap,
        categoryFilterState,
        setCategoryFilterState,
        postCommentsMap,
      }}
    >
      {children}
    </ThreadContext.Provider>
  );
};

const useThread = () => React.useContext(ThreadContext);

export { ThreadProvider, useThread };
