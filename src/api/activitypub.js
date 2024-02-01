'use strict';

/**
 * DEVELOPMENT NOTE
 *
 * THIS FILE IS UNDER ACTIVE DEVELOPMENT AND IS EXPLICITLY EXCLUDED FROM IMMUTABILITY GUARANTEES
 *
 * If you use api methods in this file, be prepared that they may be removed or modified with no warning.
 */

const nconf = require('nconf');

const db = require('../database');
const activitypub = require('../activitypub');
const posts = require('../posts');

const activitypubApi = module.exports;

activitypubApi.follow = async (caller, { uid } = {}) => {
	const result = await activitypub.helpers.query(uid);
	if (!result) {
		throw new Error('[[error:activitypub.invalid-id]]');
	}

	await activitypub.send(caller.uid, [result.actorUri], {
		type: 'Follow',
		object: result.actorUri,
	});
};

// should be .undo.follow
activitypubApi.unfollow = async (caller, { uid }) => {
	const result = await activitypub.helpers.query(uid);
	if (!result) {
		throw new Error('[[error:activitypub.invalid-id]]');
	}

	await activitypub.send(caller.uid, [result.actorUri], {
		type: 'Undo',
		object: {
			type: 'Follow',
			actor: `${nconf.get('url')}/uid/${caller.uid}`,
			object: result.actorUri,
		},
	});

	await Promise.all([
		db.sortedSetRemove(`followingRemote:${caller.uid}`, result.actorUri),
		db.decrObjectField(`user:${caller.uid}`, 'followingRemoteCount'),
	]);
};

activitypubApi.create = {};

// this might be better genericised... tbd. some of to/cc is built in mocks.
async function buildRecipients(object, uid) {
	const followers = await db.getSortedSetMembers(`followersRemote:${uid}`);
	const { to } = object;
	const targets = new Set(followers);
	const parentId = await posts.getPostField(object.inReplyTo, 'uid');
	if (activitypub.helpers.isUri(parentId)) {
		to.unshift(parentId);
	}

	return { targets };
}

activitypubApi.create.post = async (caller, { pid }) => {
	const post = (await posts.getPostSummaryByPids([pid], caller.uid, { stripTags: false })).pop();
	if (!post) {
		return;
	}

	const object = await activitypub.mocks.note(post);
	const { targets } = await buildRecipients(object, post.user.uid);

	const payload = {
		type: 'Create',
		to: object.to,
		cc: object.cc,
		object,
	};

	await activitypub.send(caller.uid, Array.from(targets), payload);
};

activitypubApi.update = {};

activitypubApi.update.profile = async (caller, { uid }) => {
	const [object, followers] = await Promise.all([
		activitypub.mocks.actor(uid),
		db.getSortedSetMembers(`followersRemote:${caller.uid}`),
	]);

	await activitypub.send(caller.uid, followers, {
		type: 'Update',
		to: [activitypub._constants.publicAddress],
		cc: [],
		object,
	});
};

activitypubApi.update.note = async (caller, { post }) => {
	const object = await activitypub.mocks.note(post);
	const { targets } = await buildRecipients(object, post.user.uid);

	const payload = {
		type: 'Update',
		to: object.to,
		cc: object.cc,
		object,
	};

	await activitypub.send(caller.uid, Array.from(targets), payload);
};

activitypubApi.like = {};

activitypubApi.like.note = async (caller, { pid }) => {
	if (!activitypub.helpers.isUri(pid)) {
		return;
	}

	const uid = await posts.getPostField(pid, 'uid');
	if (!activitypub.helpers.isUri(uid)) {
		return;
	}

	await activitypub.send(caller.uid, [uid], {
		type: 'Like',
		object: pid,
	});
};

activitypubApi.undo = {};

// activitypubApi.undo.follow =

activitypubApi.undo.like = async (caller, { pid }) => {
	if (!activitypub.helpers.isUri(pid)) {
		return;
	}

	const uid = await posts.getPostField(pid, 'uid');
	if (!activitypub.helpers.isUri(uid)) {
		return;
	}

	await activitypub.send(caller.uid, [uid], {
		type: 'Undo',
		object: {
			actor: `${nconf.get('url')}/uid/${caller.uid}`,
			type: 'Like',
			object: pid,
		},
	});
};
