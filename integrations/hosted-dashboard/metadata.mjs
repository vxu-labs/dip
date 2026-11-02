import {github,GitHubError} from './github.mjs';

// Keep the selected code branch separate from DIP's single metadata branch.
// Only a genuine 404 permits legacy fallback; permission/network errors surface.
export async function metadataBranch(token,repo,codeBranch){
 try{await github(token,`/repos/${repo}/git/ref/heads/dip%2Fstate`);return 'dip/state';}
 catch(error){if(error instanceof GitHubError&&error.status===404)return codeBranch;throw error;}
}
