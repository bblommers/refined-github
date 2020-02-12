import './latest-tag-button.css';
import React from 'dom-chef';
import cache from 'webext-storage-cache';
import alertIcon from 'octicon/alert.svg';
import tagIcon from 'octicon/tag.svg';
import elementReady from 'element-ready';
import compareVersions from 'tiny-version-compare';
import * as api from '../libs/api';
import features from '../libs/features';
import {isRepoRoot} from '../libs/page-detect';
import getDefaultBranch from '../libs/get-default-branch';
import {getRepoURL, getCurrentBranch, replaceBranch, getRepoGQL} from '../libs/utils';

const getLatestTag = cache.function(async (): Promise<string | false> => {
	const {repository} = await api.v4(`
		repository(${getRepoGQL()}) {
			refs(first: 20, refPrefix: "refs/tags/", orderBy: {
				field: TAG_COMMIT_DATE,
				direction: DESC
			}) {
				nodes {
					name
				}
			}
		}
	`);

	const tags: string[] = repository.refs.nodes.map((tag: {name: string}) => tag.name);
	if (tags.length === 0) {
		return false;
	}

	// If all tags are plain versions, parse them
	if (tags.every(tag => /^[vr]?\d/.test(tag))) {
		return tags.sort(compareVersions).pop()!;
	}

	// Otherwise just use the latest
	return tags[0];
}, {
	expiration: 1,
	cacheKey: () => __featureName__ + '_tags:' + getRepoURL()
});

const getBleedingEdgeMessage = cache.function(async (latestTag: string): Promise<string | false> => {
	// Find the latest commit from this tag and from the default branch
	const defaultBranch = await getDefaultBranch();
	const diff = await api.v3(`repos/${getRepoURL()}/compare/${latestTag}...${defaultBranch}`);
	// If the commit from the default branch differs from the latest tag, it's considered bleeding edge
	if (diff.status === "ahead") {
		return `${defaultBranch} is ${diff.ahead_by} commits ahead of the latest release`;
	} else if (diff.status === "behind") {
		return `${defaultBranch} is ${diff.behind_by} commits behind the latest release`;
	} else if (diff.status === "diverged") {
		return `${defaultBranch} is ${diff.ahead_by} commits ahead, ${diff.behind_by} commits behind the latest release`;
	} else {
		// Diff status is "identical"
		return false;
	}
}, {
	expiration: 1,
	cacheKey: () => __featureName__ + '_commits:' + getRepoURL()
});

async function getTagLink(latestRelease: string): Promise<HTMLAnchorElement> {
	const link = <a className="btn btn-sm btn-outline tooltipped tooltipped-ne ml-2">{tagIcon()}</a> as unknown as HTMLAnchorElement;

	const currentBranch = getCurrentBranch();
	if (currentBranch === latestRelease) {
		const [bleedingEdge] = await Promise.all([
			getBleedingEdgeMessage(latestRelease)
		]);
		if (bleedingEdge) {
			link.setAttribute('aria-label', bleedingEdge);
			link.append(' ', <span className="css-truncate-target">{latestRelease}</span>);
			link.append(' ', alertIcon());
		} else {
			link.setAttribute('aria-label', 'You’re on the latest release');
			link.classList.add('disabled');
		}
	} else {
		if (isRepoRoot()) {
			link.href = `/${getRepoURL()}/tree/${latestRelease}`;
		} else {
			link.href = replaceBranch(currentBranch, latestRelease);
		}

		link.setAttribute('aria-label', 'Visit the latest release');
		link.append(' ', <span className="css-truncate-target">{latestRelease}</span>);
	}

	return link;
}

async function init(): Promise<false | void> {
	const [breadcrumbs, latestTag] = await Promise.all([
		elementReady('.breadcrumb'),
		getLatestTag()
	]);

	if (!breadcrumbs || !latestTag) {
		return false;
	}

	const [tagLink] = await Promise.all([getTagLink(latestTag)]);

	breadcrumbs.before(tagLink);
}

features.add({
	id: __featureName__,
	description: 'Adds link to the latest version tag on directory listings and files.',
	screenshot: 'https://user-images.githubusercontent.com/1402241/71885167-63464500-316c-11ea-806c-5abe37281eca.png',
	include: [
		features.isRepoTree,
		features.isSingleFile
	],
	load: features.nowAndOnAjaxedPages,
	init
});
